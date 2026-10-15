use std::sync::Mutex;
use tauri::{menu::Menu, tray::TrayIconBuilder, AppHandle, Emitter, Manager, WebviewWindow};

use super::tray_menu::{self, Item};
use crate::tray_icon::{DesktopShowIn, DesktopTrayIcon};

const TRAY_ID: &str = "izci";

#[derive(Default)]
pub struct TrayState {
    menu: Option<Menu<tauri::Wry>>,
    items: Vec<Item>,
    close_to_tray: bool,
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    crate::native_filesystem::require_app_window(window)?;
    if window.label() != "main" {
        return Err("Only the player configures the tray".into());
    }
    Ok(())
}

pub fn restore_main(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Player is unavailable")?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn close_to_tray(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
        && app
            .state::<Mutex<TrayState>>()
            .lock()
            .is_ok_and(|state| state.close_to_tray)
}

fn action(app: &AppHandle, id: &str) {
    let enabled = app
        .state::<Mutex<TrayState>>()
        .lock()
        .is_ok_and(|state| tray_menu::enabled_action(&state.items, id));
    if !enabled {
        return;
    }
    let result = match id {
        "showMain" => restore_main(app),
        "hideMain" => app
            .get_webview_window("main")
            .ok_or("Player is unavailable".into())
            .and_then(|window| window.hide().map_err(|error| error.to_string())),
        // The playback owner handles shutdown and transport, including remote
        // Multiplayer state. Never create or control another player here.
        _ => app
            .emit_to("main", "izci:desktop-tray-action", id)
            .map_err(|error| error.to_string()),
    };
    if let Err(error) = result {
        eprintln!("Could not run tray action: {error}");
    }
}

#[tauri::command]
pub fn configure_linux_tray(
    app: AppHandle,
    window: WebviewWindow,
    show_in: DesktopShowIn,
    tray_icon: DesktopTrayIcon,
    close_to_tray: bool,
    items: Vec<Item>,
) -> Result<(), String> {
    require_main(&window)?;
    configure(&app, &window, show_in, tray_icon, close_to_tray, items)
        .map_err(|error| error.to_string())
}

fn configure(
    app: &AppHandle,
    window: &WebviewWindow,
    show_in: DesktopShowIn,
    tray_icon: DesktopTrayIcon,
    close_to_tray: bool,
    items: Vec<Item>,
) -> tauri::Result<()> {
    // Commands run on the GTK thread. Do not hold this state from a worker while
    // waiting on GTK, which could deadlock a native menu/close callback.
    if !matches!(show_in, DesktopShowIn::Tray) {
        window.set_skip_taskbar(false)?;
    }
    if matches!(show_in, DesktopShowIn::Taskbar) {
        // Removing the only way to reach a hidden player must restore it first.
        if app.tray_by_id(TRAY_ID).is_some() && !window.is_visible()? {
            window.show()?;
        }
        app.remove_tray_by_id(TRAY_ID);
        *app.state::<Mutex<TrayState>>().lock().unwrap() = TrayState::default();
        return Ok(());
    }
    let managed = app.state::<Mutex<TrayState>>();
    let mut state = managed.lock().unwrap();
    let menu = match &state.menu {
        Some(menu) => menu.clone(),
        None => Menu::new(app)?,
    };
    if state.items != items {
        let replacement = tray_menu::build(app, &items)?;
        tray_menu::replace(&menu, &replacement)?;
    }
    if let Some(icon) = app.tray_by_id(TRAY_ID) {
        icon.set_icon(Some(tray_icon.image()))?;
    } else {
        TrayIconBuilder::with_id(TRAY_ID)
            .icon(tray_icon.image())
            .menu(&menu)
            .on_menu_event(|app, event| action(app, event.id.as_ref()))
            .build(app)?;
    }
    state.menu = Some(menu);
    state.items = items;
    state.close_to_tray = close_to_tray;
    drop(state);
    // Create the indicator successfully before removing taskbar access.
    window.set_skip_taskbar(matches!(show_in, DesktopShowIn::Tray))
}

#[tauri::command]
pub fn restore_main_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    restore_main(&app)
}
