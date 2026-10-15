use tauri::WebviewWindow;

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || !window
            .url()
            .is_ok_and(|url| crate::windows::is_app_url(&url))
    {
        return Err("Fullscreen control is only available to the packaged main window".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn read_desktop_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    require_main(&window)?;
    let gtk = window.gtk_window().map_err(|error| error.to_string())?;
    // WebKit's DOM fullscreen handler and the window manager change GTK
    // directly, bypassing Tao's cached fullscreen value.
    Ok(gtk::prelude::WidgetExt::window(&gtk)
        .is_some_and(|surface| surface.state().contains(gtk::gdk::WindowState::FULLSCREEN)))
}

#[tauri::command]
pub(crate) fn set_desktop_fullscreen(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    require_main(&window)?;
    window
        .set_fullscreen(enabled)
        .map_err(|error| error.to_string())
}
