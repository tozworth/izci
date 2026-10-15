pub(crate) mod file_picker;
pub(crate) mod files;
mod fonts;
pub(crate) mod fullscreen;
pub(crate) mod tray;
mod tray_menu;
pub(crate) mod window_state;

use tauri::{Manager, WebviewWindow, WindowEvent};

#[tauri::command]
pub(crate) fn desktop_window_ready(window: WebviewWindow) -> Result<(), String> {
    crate::native_filesystem::require_app_window(&window)?;
    window_state::attach(&window).map_err(|error| error.to_string())?;
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
        .manage(window_state::WindowState::default())
        // Tauri's menu callbacks are global and outlive removed icons. Register
        // once so disabling/re-enabling the tray cannot duplicate transport.
        .on_menu_event(|app, event| tray::action(app, event.id.as_ref()))
        .invoke_handler(tauri::generate_handler![
            desktop_window_ready,
            fullscreen::read_desktop_fullscreen,
            fullscreen::set_desktop_fullscreen,
            exit_desktop,
            tray::configure_linux_tray,
            tray::restore_main_window,
            files::materialize_desktop_files,
            fonts::local_font_families,
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
            if matches!(event, WindowEvent::Destroyed) {
                window_state::forget(window.app_handle(), window.label());
            }
            if let WindowEvent::CloseRequested { .. } = event {
                window_state::save(window.app_handle());
            }
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
        .build(tauri::generate_context!())
        .expect("Could not start izci")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                window_state::save(app);
            }
        });
}
