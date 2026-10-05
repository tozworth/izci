use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    utils::config::WindowConfig, webview::NewWindowResponse, AppHandle, WebviewWindowBuilder,
};
use webkit2gtk::{SettingsExt, WebViewExt};

static POPUP_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn is_app_url(url: &tauri::Url) -> bool {
    url.scheme() == "tauri" && url.host_str() == Some("localhost")
}

pub fn builder<'a>(
    app: &'a AppHandle,
    config: &WindowConfig,
) -> tauri::Result<WebviewWindowBuilder<'a, tauri::Wry, AppHandle>> {
    let popup_app = app.clone();
    Ok(WebviewWindowBuilder::from_config(app, config)?
        .on_page_load(|window, _| {
            // Native picker responses, restored playback, and remote transport
            // can run after a DOM gesture. Match Windows' native autoplay policy.
            let _ = window.with_webview(|webview| {
                if let Some(settings) = webview.inner().settings() {
                    settings.set_media_playback_requires_user_gesture(false);
                }
            });
        })
        .on_navigation(|url| is_app_url(url) || url.as_str() == "about:blank")
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .on_new_window(move |url, features| {
            if !is_app_url(&url) && url.as_str() != "about:blank" {
                return NewWindowResponse::Deny;
            }
            let config = WindowConfig {
                label: format!("popup-{}", POPUP_ID.fetch_add(1, Ordering::Relaxed)),
                title: "izci".into(),
                url: tauri::WebviewUrl::External("about:blank".parse().unwrap()),
                decorations: false,
                visible: false,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_packaged_origin_has_native_file_access() {
        assert!(is_app_url(&"tauri://localhost/index.html".parse().unwrap()));
        for url in [
            "https://localhost/",
            "tauri://other/",
            "file:///tmp/index.html",
            "about:blank",
        ] {
            assert!(!is_app_url(&url.parse().unwrap()));
        }
    }
}
