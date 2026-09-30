use tauri::WebviewWindow;
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile4, ICoreWebView2_13, COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    },
    SetPermissionStateCompletedHandler,
};
use windows::core::{w, Interface};

// WebView2 revokes per-handle grants across launches. Profile permission alone
// does not restore them: request read access on the real saved handle with native
// activation. Chromium still restricts access to files/directories the user picked.
#[tauri::command]
pub async fn prepare_desktop_playback_restoration(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || !window
            .url()
            .is_ok_and(|url| crate::windows::is_app_url(&url))
    {
        return Err("Only the packaged playback owner can restore file access".into());
    }
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    window
        .with_webview(move |webview| {
            let completion = sender.clone();
            let handler = SetPermissionStateCompletedHandler::create(Box::new(move |error| {
                let _ = completion.try_send(error.map_err(|error| error.to_string()));
                Ok(())
            }));
            let result = unsafe {
                webview.controller().CoreWebView2().and_then(|core| {
                    let profile = core.cast::<ICoreWebView2_13>()?.Profile()?;
                    profile.cast::<ICoreWebView2Profile4>()?.SetPermissionState(
                        COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE,
                        w!("https://tauri.localhost"),
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                        &handler,
                    )
                })
            };
            if let Err(error) = result {
                let _ = sender.try_send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("File permission setup was interrupted")??;
    let result = crate::desktop_files::devtools(
        &window,
        "Runtime.evaluate",
        serde_json::json!({
            "expression": "window.__izciRestoreFileAccess?.()",
            "awaitPromise": true,
            "returnByValue": true,
            "userGesture": true
        }),
    )
    .await?;
    if result
        .pointer("/result/value")
        .and_then(serde_json::Value::as_str)
        != Some("granted")
    {
        return Err("Saved file handle read access was not granted".into());
    }
    Ok(())
}
