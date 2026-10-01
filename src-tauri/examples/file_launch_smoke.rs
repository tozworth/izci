//! Hidden WebView2 integration check. Uses a disposable browser profile and no registry writes.
#[allow(dead_code)]
#[path = "../src/associations.rs"]
mod associations;
#[allow(dead_code)]
#[path = "../src/desktop_files.rs"]
mod desktop_files;
#[path = "../src/file_icons.rs"]
mod file_icons;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::core::HSTRING;

async fn evaluate(
    window: &tauri::WebviewWindow,
    expression: &str,
) -> Result<serde_json::Value, String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let parameters = HSTRING::from(serde_json::json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }).to_string());
    window
        .with_webview(move |webview| {
            let completion = sender.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |error, result| {
                    let result = error.map_err(|error| error.to_string()).and_then(|_| {
                        serde_json::from_str(&result).map_err(|error| error.to_string())
                    });
                    let _ = completion.try_send(result);
                    Ok(())
                },
            ));
            let result = unsafe {
                webview.controller().CoreWebView2().and_then(|core| {
                    core.CallDevToolsProtocolMethod(
                        &HSTRING::from("Runtime.evaluate"),
                        &parameters,
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
        .ok_or("WebView2 evaluation interrupted")?
}

async fn check(window: &tauri::WebviewWindow, path: &str) -> Result<(), String> {
    evaluate(window, "(() => { const input = document.createElement('input'); input.id = 'izci-desktop-file-input'; input.type = 'file'; input.multiple = true; document.body.append(input); })()").await?;
    let paths = desktop_files::materialize_desktop_files(window.clone(), vec![path.into()]).await?;
    if paths.len() != 1 {
        return Err("No native file selected".into());
    }
    let selected = evaluate(window, "({ name: document.getElementById('izci-desktop-file-input').files[0].name, size: document.getElementById('izci-desktop-file-input').files[0].size })").await?;
    if selected
        .pointer("/result/value/name")
        .and_then(serde_json::Value::as_str)
        != Some("şarkı with spaces.hvl")
        || selected
            .pointer("/result/value/size")
            .and_then(serde_json::Value::as_u64)
            != Some(4)
    {
        return Err("Chromium did not return the expected disk-backed File".into());
    }
    let bytes = evaluate(window, "document.getElementById('izci-desktop-file-input').files[0].arrayBuffer().then(buffer => Array.from(new Uint8Array(buffer)))").await?;
    if bytes.pointer("/result/value") != Some(&serde_json::json!([72, 86, 76, 33])) {
        return Err("Chromium could not read the disk-backed File".into());
    }
    Ok(())
}

fn main() {
    let directory =
        std::env::temp_dir().join(format!("izci-native-file-smoke-{}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("Temporary smoke directory");
    let path = directory.join("şarkı with spaces.hvl");
    std::fs::write(&path, b"HVL!").expect("Temporary Hively file");
    let profile = directory.join("profile");
    tauri::Builder::default().setup(move |app| {
        let path = path.to_string_lossy().to_string();
        let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External("about:blank".parse().unwrap()))
            .visible(false).data_directory(profile).build()?;
        tauri::async_runtime::spawn(async move {
            match check(&window, &path).await {
                Ok(()) => { println!("Verified: Unicode Windows path materializes as a disk-backed Chromium File without media bytes over IPC."); window.app_handle().exit(0); }
                Err(error) => { eprintln!("Native file smoke check failed: {error}"); window.app_handle().exit(1); }
            }
        });
        Ok(())
    }).run(tauri::generate_context!()).expect("Hidden WebView2 smoke check");
    // The profile may remain locked briefly while WebView2 exits; retain it if so.
    let _ = std::fs::remove_file(directory.join("şarkı with spaces.hvl"));
}
