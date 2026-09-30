use crate::window_lifecycle::{self, WindowRole};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    utils::config::WindowConfig,
    webview::{Color, NewWindowResponse, PermissionKind, PermissionResponse},
    AppHandle, Manager, WebviewWindowBuilder,
};

static POPUP_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn is_app_url(url: &tauri::Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("tauri.localhost")
}

pub fn builder<'a>(
    app: &'a AppHandle,
    config: &WindowConfig,
) -> tauri::Result<WebviewWindowBuilder<'a, tauri::Wry, AppHandle>> {
    let popup_app = app.clone();
    let navigation_app = app.clone();
    let navigation_label = config.label.clone();
    let initial_role = match &config.url {
        tauri::WebviewUrl::App(path) => WindowRole::from_path(&path.to_string_lossy()),
        tauri::WebviewUrl::External(url) if is_app_url(url) => WindowRole::from_path(url.path()),
        _ => WindowRole::Utility,
    };
    window_lifecycle::record(app, &config.label, initial_role);
    Ok(WebviewWindowBuilder::from_config(app, config)?
        // Popups start at about:blank before the opener primes their theme.
        // Set both the native surface and WebView2's creation-time background
        // so neither window creation nor page navigation exposes default white.
        .background_color(config.background_color.unwrap_or(Color(24, 25, 27, 255)))
        // Keep transport timers running while the playback owner is minimized.
        // Retain Wry's default disabled browser UI features when adding arguments.
        .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows")
        .on_navigation(move |url| {
            if is_app_url(url) {
                window_lifecycle::record(&navigation_app, &navigation_label, WindowRole::from_path(url.path()));
                true
            } else { url.as_str() == "about:blank" }
        })
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
                // WebView2 must attach the new controller to its opener before
                // navigating it. SetNewWindow supplies the requested URL; an
                // eager navigation here can stall window.open on cached loads.
                url: tauri::WebviewUrl::External("about:blank".parse().unwrap()),
                use_https_scheme: true,
                drag_drop_enabled: false,
                decorations: false,
                visible: false,
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

pub fn is_options_window(window: &tauri::WebviewWindow) -> bool {
    window_lifecycle::role(window).reusable()
}

pub fn create_player_windows(app: &AppHandle) -> tauri::Result<()> {
    crate::tray::create_menu(app)?;
    // The playback owner can immediately request an Options popup. Finish all
    // utility controller creation before allowing its frontend to run.
    for config in app
        .config()
        .app
        .windows
        .iter()
        .filter(|config| config.label != "main")
        .chain(
            app.config()
                .app
                .windows
                .iter()
                .filter(|config| config.label == "main"),
        )
    {
        if app.get_webview_window(&config.label).is_none() {
            builder(app, config)?.build()?;
        }
    }
    Ok(())
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
