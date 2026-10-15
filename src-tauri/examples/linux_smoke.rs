//! Isolated Linux shell / native chooser / real playback smoke check.
#[cfg(target_os = "linux")]
#[path = "../src/linux/mod.rs"]
#[allow(dead_code)]
mod linux;
#[cfg(target_os = "linux")]
#[path = "../src/native_filesystem.rs"]
mod native_filesystem;
#[cfg(target_os = "linux")]
#[path = "../src/tray_icon.rs"]
mod tray_icon;
#[cfg(target_os = "linux")]
#[path = "../src/linux/windows.rs"]
mod windows;

#[cfg(target_os = "linux")]
#[tauri::command]
fn smoke_windows(app: tauri::AppHandle) -> serde_json::Value {
    use tauri::Manager;
    serde_json::Value::Array(
        app.webview_windows()
            .values()
            .map(|window| {
                serde_json::json!({
                    "label": window.label(), "url": window.url().ok().map(|url| url.to_string()),
                    "visible": window.is_visible().unwrap_or(false),
                    "width": window.inner_size().ok().map(|size| size.width),
                    "height": window.inner_size().ok().map(|size| size.height),
                    "x": window.outer_position().ok().map(|position| position.x),
                    "y": window.outer_position().ok().map(|position| position.y)
                })
            })
            .collect(),
    )
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn smoke_options_placement(app: tauri::AppHandle, check_saved: bool) -> Result<(), String> {
    use tauri::Manager;
    if check_saved {
        let path = app
            .path()
            .app_config_dir()
            .map_err(|error| error.to_string())?
            .join("options-window-state.json");
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        if saved["x"] != 120 || saved["y"] != 140 || saved["width"] != 900 || saved["height"] != 640
        {
            return Err(format!("Incorrect saved Options placement: {saved}"));
        }
        return Ok(());
    }
    let options = app
        .webview_windows()
        .into_values()
        .find(|window| window.url().is_ok_and(|url| url.path() == "/options.html"))
        .ok_or("Options not found")?;
    options
        .set_position(tauri::PhysicalPosition::new(120, 140))
        .map_err(|error| error.to_string())?;
    options
        .set_size(tauri::PhysicalSize::new(900, 640))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn smoke_report(app: tauri::AppHandle, result: serde_json::Value) {
    println!("{result}");
    app.exit(if result["ok"] == true { 0 } else { 1 });
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn smoke_tray(app: tauri::AppHandle, action: Option<String>) -> serde_json::Value {
    if let Some(action) = action {
        // Use the actual native menu callback, including its enabled-item guard
        // and targeted event dispatch to the mounted playback owner.
        linux::tray::action(&app, &action);
    }
    serde_json::json!({
        "available": app.tray_by_id("izci").is_some(),
        "closeToTray": linux::tray::close_to_tray(&app)
    })
}

#[cfg(target_os = "linux")]
fn main() {
    use gtk::prelude::*;
    use std::{cell::Cell, rc::Rc, time::Duration};
    use tauri::Manager;
    use webkit2gtk::{SettingsExt, WebViewExt};

    let args: Vec<String> = std::env::args().skip(1).collect();
    let placement_only = args.iter().any(|arg| arg == "--options-placement");
    let paths: Vec<String> = args
        .into_iter()
        .filter(|arg| arg != "--options-placement")
        .collect();
    assert!(
        placement_only || !paths.is_empty(),
        "Usage: linux_smoke [--options-placement] <audio paths...>"
    );
    let script = include_str!("support/linux-smoke.js")
        .replace("__SMOKE_PATHS__", &serde_json::to_string(&paths).unwrap())
        .replace(
            "__SMOKE_PLACEMENT_ONLY__",
            if placement_only { "true" } else { "false" },
        );
    let mut context = tauri::generate_context!();
    // Separate native storage namespace; the harness cannot open ordinary data.
    context.config_mut().identifier = format!("app.izci.linux-smoke.{}", std::process::id());
    tauri::Builder::default()
        .manage(std::sync::Mutex::new(linux::tray::TrayState::default()))
        .manage(linux::window_state::WindowState::default())
        .on_menu_event(|app, event| linux::tray::action(app, event.id.as_ref()))
        .invoke_handler(tauri::generate_handler![
            linux::desktop_window_ready,
            smoke_windows,
            smoke_options_placement,
            smoke_report,
            smoke_tray,
            linux::tray::configure_linux_tray,
            linux::tray::restore_main_window,
            linux::files::materialize_desktop_files,
            native_filesystem::pick_desktop_paths,
            native_filesystem::read_desktop_folder,
            native_filesystem::query_desktop_folder_permission
        ])
        .setup(move |app| {
            // Seed an earlier session's Options placement to exercise the disk
            // restore path before any in-memory placement exists.
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            std::fs::write(
                config_dir.join("options-window-state.json"),
                r#"{"x":80,"y":100,"width":820,"height":620,"maximized":false}"#,
            )?;
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|config| config.label == "main")
                .unwrap();
            let main = windows::builder(app.handle(), config)?
                .initialization_script(script.clone())
                .build()?;
            // The harness dispatches DOM clicks without a trusted user gesture.
            // Keep popup blocking unchanged in the ordinary player.
            main.with_webview(|webview| {
                if let Some(settings) = WebViewExt::settings(&webview.inner()) {
                    settings.set_javascript_can_open_windows_automatically(true);
                }
            })?;
            let selection = Rc::new(Cell::new(0));
            // Native chooser fallback windows on the isolated Xvfb display.
            // Supply files to the same OS dialog opened by File > Open files.
            gtk::glib::timeout_add_local(Duration::from_millis(200), move || {
                for window in gtk::Window::list_toplevels() {
                    if let Ok(dialog) = window.downcast::<gtk::FileChooserDialog>() {
                        if !dialog.is_visible() {
                            continue;
                        }
                        let index = selection.get();
                        if dialog.action() == gtk::FileChooserAction::SelectFolder {
                            let folder = std::path::Path::new(&paths[0]).parent().unwrap();
                            if dialog.filename().as_deref() == Some(folder) {
                                dialog.response(gtk::ResponseType::Accept);
                            } else {
                                dialog.set_current_folder(folder);
                            }
                            continue;
                        }
                        if let Some(path) = paths.get(index) {
                            if dialog.filename().as_deref() == Some(std::path::Path::new(path)) {
                                dialog.response(gtk::ResponseType::Accept);
                                selection.set(index + 1);
                            } else {
                                dialog.set_filename(path);
                            }
                        } else {
                            dialog.response(gtk::ResponseType::Cancel);
                        }
                    }
                }
                gtk::glib::ControlFlow::Continue
            });
            let app = app.handle().clone();
            gtk::glib::timeout_add_local_once(Duration::from_secs(90), move || {
                eprintln!("Linux smoke timed out");
                app.exit(1);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                linux::window_state::save(window.app_handle());
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                linux::window_state::forget(window.app_handle(), window.label());
            }
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if linux::tray::close_to_tray(window.app_handle()) {
                        api.prevent_close();
                        window.hide().unwrap();
                    }
                }
            }
        })
        .run(context)
        .expect("Linux smoke runtime");
}

#[cfg(not(target_os = "linux"))]
fn main() {
    panic!("linux_smoke requires Linux");
}
