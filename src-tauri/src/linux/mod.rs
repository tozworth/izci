pub(crate) mod file_picker;
pub(crate) mod files;
pub(crate) mod tray;
mod tray_menu;

use tauri::{Manager, WebviewWindow, WindowEvent};

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
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = tray::restore_main(app);
        }))
        .manage(std::sync::Mutex::new(tray::TrayState::default()))
        // Tauri's menu callbacks are global and outlive removed icons. Register
        // once so disabling/re-enabling the tray cannot duplicate transport.
        .on_menu_event(|app, event| tray::action(app, event.id.as_ref()))
        .invoke_handler(tauri::generate_handler![
            desktop_window_ready,
            exit_desktop,
            tray::configure_linux_tray,
            tray::restore_main_window,
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
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if tray::close_to_tray(window.app_handle()) {
                    // If hiding fails, leave the player accessible.
                    if let Err(error) = window.hide() {
                        eprintln!("Could not hide the player: {error}");
                    }
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not start izci");
}
