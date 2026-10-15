//! Isolated Linux Oda tray-entry / fullscreen restoration regression check.
#[cfg(target_os = "linux")]
use tauri::Manager;
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
fn oda_smoke_state(window: tauri::WebviewWindow) -> serde_json::Value {
    let size = window.inner_size().unwrap();
    serde_json::json!({
        "fullscreen": linux::fullscreen::read_desktop_fullscreen(window.clone()).unwrap(),
        "visible": window.is_visible().unwrap(),
        "tray": window.app_handle().tray_by_id("izci").is_some(),
        "width": size.width, "height": size.height
    })
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn oda_smoke_tray_entry(window: tauri::WebviewWindow) {
    window.hide().unwrap();
    // Exercise the actual native tray callback and its enabled-action guard.
    linux::tray::action(window.app_handle(), "enterOda");
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn oda_smoke_finish(app: tauri::AppHandle, result: serde_json::Value) {
    println!("{result}");
    app.exit(if result["ok"] == true { 0 } else { 1 });
}

#[cfg(target_os = "linux")]
fn main() {
    use std::time::Duration;
    let mut context = tauri::generate_context!();
    // Never open or alter the ordinary player's profile or window placement.
    context.config_mut().identifier = format!("app.izci.oda-smoke.{}", std::process::id());
    tauri::Builder::default()
        .manage(linux::window_state::WindowState::default())
        .manage(std::sync::Mutex::new(linux::tray::TrayState::default()))
        .on_menu_event(|app, event| linux::tray::action(app, event.id.as_ref()))
        .invoke_handler(tauri::generate_handler![
            linux::desktop_window_ready,
            linux::fullscreen::read_desktop_fullscreen,
            linux::fullscreen::set_desktop_fullscreen,
            linux::tray::configure_linux_tray,
            linux::tray::restore_main_window,
            oda_smoke_state,
            oda_smoke_tray_entry,
            oda_smoke_finish
        ])
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|c| c.label == "main")
                .unwrap();
            windows::builder(app.handle(), config)?
                .initialization_script(include_str!("support/linux-oda-smoke.js"))
                .build()?;
            let app = app.handle().clone();
            gtk::glib::timeout_add_local_once(Duration::from_secs(45), move || {
                eprintln!("Oda fullscreen smoke timed out");
                app.exit(1);
            });
            Ok(())
        })
        .run(context)
        .expect("Oda smoke runtime");
}
#[cfg(not(target_os = "linux"))]
fn main() {
    panic!("linux_oda_smoke requires Linux");
}
