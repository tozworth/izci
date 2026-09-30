use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

// Session mode survives dismissing the mini window to the tray.
#[derive(Default)]
pub struct PlayerWindowMode(AtomicBool);

pub fn mini_active(app: &AppHandle) -> bool {
    app.state::<PlayerWindowMode>().0.load(Ordering::SeqCst)
}

pub fn activate_mini(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Main window is closed")?;
    let mini = app
        .get_webview_window("mini-player")
        .ok_or("Miniplayer is unavailable")?;
    // Hide only the native playback window; its WebView/audio must stay active.
    crate::window_state::capture(&main.as_ref().window());
    main.hide().map_err(|error| error.to_string())?;
    crate::window_resources::show(&mini)?;
    mini.unminimize().map_err(|error| error.to_string())?;
    app.state::<PlayerWindowMode>()
        .0
        .store(true, Ordering::SeqCst);
    mini.set_focus().map_err(|error| error.to_string())
}

pub fn open_mini(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Main window is closed")?;
    let mini = app
        .get_webview_window("mini-player")
        .ok_or("Miniplayer is unavailable")?;
    crate::window_state::capture(&main.as_ref().window());
    main.hide().map_err(|error| error.to_string())?;
    // Restoring WINDOWPLACEMENT can show the HWND. Hide the main window first.
    if !mini.is_visible().unwrap_or(false) {
        crate::window_state::restore(&mini.as_ref().window());
    }
    if let Err(error) = activate_mini(app) {
        let _ = restore_main(app);
        return Err(error);
    }
    crate::window_state::capture(&mini.as_ref().window());
    Ok(())
}

fn hide_mini(app: &AppHandle) -> Result<(), String> {
    if let Some(mini) = app.get_webview_window("mini-player") {
        crate::window_state::save(&mini.as_ref().window());
        crate::window_resources::hide(&mini)?;
    }
    Ok(())
}

pub fn dismiss_mini(app: &AppHandle) -> Result<(), String> {
    if app.tray_by_id("izci").is_some() {
        hide_mini(app)
    } else {
        // Keep a taskbar entry available when the user has disabled the tray.
        let mini = app
            .get_webview_window("mini-player")
            .ok_or("Miniplayer is unavailable")?;
        mini.minimize().map_err(|error| error.to_string())
    }
}

pub fn end_mini(app: &AppHandle) -> Result<(), String> {
    hide_mini(app)?;
    app.state::<PlayerWindowMode>()
        .0
        .store(false, Ordering::SeqCst);
    app.emit_to("main", "izci:desktop-mini-closed", ())
        .map_err(|error| error.to_string())
}

pub fn restore_main(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Main window is closed")?;
    end_mini(app)?;
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())
}
