use gtk::prelude::*;
use tauri::{Manager, WebviewWindow};

#[tauri::command]
pub async fn local_font_families(window: WebviewWindow) -> Result<Vec<String>, String> {
    crate::native_filesystem::require_app_window(&window)?;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let app = window.app_handle().clone();
    // GTK/Pango objects belong to the UI thread. Enumerate through the native
    // window's font context rather than WebKit's unsupported Local Font API.
    app.run_on_main_thread(move || {
        let result = window
            .gtk_window()
            .map_err(|error| error.to_string())
            .map(|window| {
                let mut families: Vec<String> = window
                    .pango_context()
                    .list_families()
                    .into_iter()
                    .map(|family| family.name().trim().to_owned())
                    .filter(|family| !family.is_empty())
                    .collect();
                families.sort_unstable();
                families.dedup();
                families
            });
        let _ = sender.try_send(result);
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("Font enumeration was interrupted")?
}
