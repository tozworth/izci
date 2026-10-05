pub(crate) mod file_picker;
pub(crate) mod files;

use tauri::{Manager, WebviewWindow};

#[tauri::command]
fn desktop_window_ready(window: WebviewWindow) -> Result<(), String> {
    crate::native_filesystem::require_app_window(&window)?;
    window.show().map_err(|error| error.to_string())
}

#[tauri::command]
fn exit_desktop(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can exit the player".into());
    }
    window.app_handle().exit(0);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_window_ready,
            exit_desktop,
            files::materialize_desktop_files,
            crate::native_filesystem::pick_desktop_paths,
            crate::native_filesystem::read_desktop_folder,
            crate::native_filesystem::query_desktop_folder_permission
        ])
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|config| config.label == "main")
                .expect("Main window configuration");
            crate::windows::builder(app.handle(), config)?.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Could not start izci");
}
