use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    utils::config::WindowConfig,
    webview::{NewWindowResponse, PermissionKind, PermissionResponse},
    AppHandle, Manager, WebviewWindowBuilder,
};

static POPUP_ID: AtomicU64 = AtomicU64::new(1);

fn is_app_url(url: &tauri::Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("tauri.localhost")
}

pub fn builder<'a>(
    app: &'a AppHandle,
    config: &WindowConfig,
) -> tauri::Result<WebviewWindowBuilder<'a, tauri::Wry, AppHandle>> {
    let popup_app = app.clone();
    Ok(WebviewWindowBuilder::from_config(app, config)?
        // Keep transport timers running while the playback owner is minimized.
        // Retain Wry's default disabled browser UI features when adding arguments.
        .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows")
        .on_navigation(|url| is_app_url(url) || url.as_str() == "about:blank")
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .on_permission_request(|webview, kind| {
            // Chromium still limits access to handles explicitly picked by the user.
            // Allow their read/write permissions in our local UI, including after restart.
            if kind == PermissionKind::FileSystemAccess
                && webview.url().is_ok_and(|url| is_app_url(&url))
            {
                PermissionResponse::Allow
            } else {
                PermissionResponse::Default
            }
        })
        .on_new_window(move |url, features| {
            if !is_app_url(&url) && url.as_str() != "about:blank" {
                return NewWindowResponse::Deny;
            }
            // Preserve Chromium's opener/postMessage relationship for existing tools.
            let config = WindowConfig {
                label: format!("popup-{}", POPUP_ID.fetch_add(1, Ordering::Relaxed)),
                title: "izci".into(),
                url: tauri::WebviewUrl::External(url),
                use_https_scheme: true,
                drag_drop_enabled: false,
                ..Default::default()
            };
            match builder(&popup_app, &config)
                .and_then(|builder| builder.window_features(features).build())
            {
                Ok(window) => NewWindowResponse::Create { window },
                Err(_) => NewWindowResponse::Deny,
            }
        }))
}

pub fn restore_main(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Main window is closed")?;
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_app_url;

    #[test]
    fn only_the_packaged_https_origin_receives_native_file_permissions() {
        assert!(is_app_url(
            &"https://tauri.localhost/index.html".parse().unwrap()
        ));
        assert!(is_app_url(
            &"https://tauri.localhost/troubadour.html".parse().unwrap()
        ));
        for url in [
            "http://tauri.localhost",
            "https://tauri.localhost.example.com",
            "https://example.com",
            "file:///C:/music/index.html",
            "about:blank",
        ] {
            assert!(!is_app_url(&url.parse().unwrap()));
        }
    }
}
