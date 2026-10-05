use gtk::glib::prelude::ObjectExt;
use std::path::Path;
use tauri::WebviewWindow;
use webkit2gtk::{FileChooserRequestExt, WebViewExt};

// WebKit's chooser supplies disk-backed Files without passing media bytes over
// IPC. The frontend serializes materialization and waits for the input's change.
#[tauri::command]
pub async fn materialize_desktop_files(
    window: WebviewWindow,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    crate::native_filesystem::require_app_window(&window)?;
    if paths.len() > 1024 {
        return Err("Too many files".into());
    }
    let paths = tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|path| crate::native_filesystem::canonical_path(Path::new(path), false))
            .collect::<Result<Vec<_>, _>>()
    })
    .await
    .map_err(|error| error.to_string())??;
    if paths.is_empty() {
        return Ok(paths);
    }
    let selection = paths.clone();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    window
        .with_webview(move |webview| {
            let view = webview.inner();
            let selection = std::cell::RefCell::new(Some(selection));
            let handler = view.connect_run_file_chooser(move |_, request| {
                let Some(paths) = selection.borrow_mut().take() else {
                    return false;
                };
                let names: Vec<&str> = paths.iter().map(String::as_str).collect();
                request.select_files(&names);
                let _ = sender.try_send(());
                true
            });
            // Keep this signal's lifetime bounded even when script execution fails.
            let cleanup_view = view.clone();
            view.evaluate_javascript(
                "document.getElementById('izci-desktop-file-input').click()",
                None,
                None,
                None::<&gtk::gio::Cancellable>,
                move |_| {
                    cleanup_view.disconnect(handler);
                },
            );
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("WebKit file selection was interrupted")?;
    Ok(paths)
}
