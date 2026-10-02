use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

// Session mode survives dismissing the mini window to the tray.
#[derive(Default)]
pub struct PlayerWindowMode {
    mini: AtomicBool,
    close_to_tray: AtomicBool,
}

pub fn mini_active(app: &AppHandle) -> bool {
    app.state::<PlayerWindowMode>().mini.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn configure_desktop_close(window: WebviewWindow, close_to_tray: bool) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the player configures desktop close behavior".into());
    }
    window
        .app_handle()
        .state::<PlayerWindowMode>()
        .close_to_tray
        .store(close_to_tray, Ordering::SeqCst);
    Ok(())
}

pub fn close_main(app: &AppHandle) -> Result<(), String> {
    if app
        .state::<PlayerWindowMode>()
        .close_to_tray
        .load(Ordering::SeqCst)
        && app.tray_by_id("izci").is_some()
    {
        let main = app
            .get_webview_window("main")
            .ok_or("Main window is closed")?;
        crate::window_state::save(&main.as_ref().window());
        // Keep the playback owner's WebView/audio active, as in mini mode.
        main.hide().map_err(|error| error.to_string())
    } else {
        crate::window_lifecycle::close_player(app);
        Ok(())
    }
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
        .mini
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
        .mini
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
