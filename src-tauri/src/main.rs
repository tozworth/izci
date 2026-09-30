#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
compile_error!("The izci desktop MVP currently supports Windows only.");

mod windows;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

fn require_player_window(window: &WebviewWindow) -> Result<(), String> {
    match window.label() {
        "main" | "mini-player" => Ok(()),
        _ => Err("This command is only available to player windows".into()),
    }
}

#[tauri::command]
fn open_mini_player(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the playback owner can open the miniplayer".into());
    }
    let mini = app
        .get_webview_window("mini-player")
        .ok_or("Miniplayer is unavailable")?;
    mini.show().map_err(|error| error.to_string())?;
    mini.set_focus().map_err(|error| error.to_string())?;
    window.minimize().map_err(|error| error.to_string())
}

fn close_mini(app: &AppHandle) -> Result<(), String> {
    if let Some(mini) = app.get_webview_window("mini-player") {
        mini.hide().map_err(|error| error.to_string())?;
    }
    app.emit_to("main", "izci:desktop-mini-closed", ())
        .map_err(|error| error.to_string())?;
    windows::restore_main(app)
}

#[tauri::command]
fn close_mini_player(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_player_window(&window)?;
    close_mini(&app)
}

#[tauri::command]
fn restore_main_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_player_window(&window)?;
    windows::restore_main(&app)
}

#[tauri::command]
fn pin_mini_player(window: WebviewWindow, pinned: bool) -> Result<(), String> {
    if window.label() != "mini-player" {
        return Err("Only the miniplayer can change its pin state".into());
    }
    window
        .set_always_on_top(pinned)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn exit_desktop(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can exit the player".into());
    }
    window.close().map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_mini_player,
            close_mini_player,
            restore_main_window,
            pin_mini_player,
            exit_desktop
        ])
        .setup(|app| {
            for config in &app.config().app.windows {
                windows::builder(app.handle(), config)?.build()?;
            }
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("mini-player", WindowEvent::CloseRequested { api, .. }) => {
                if window.app_handle().get_webview_window("main").is_some() {
                    api.prevent_close();
                    let _ = close_mini(window.app_handle());
                }
            }
            ("main", WindowEvent::Destroyed) => {
                // The hidden miniplayer must not keep the process alive after the owner exits.
                // Troubadour retains its existing ability to finish file-write jobs.
                for (label, child) in window.app_handle().webview_windows() {
                    if label == "main" {
                        continue;
                    }
                    let workbench = child.url().is_ok_and(|url| {
                        matches!(url.path(), "/troubadour.html" | "/troubadour-options.html")
                    });
                    if !workbench {
                        let _ = child.destroy();
                    }
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("Could not start izci");
}
