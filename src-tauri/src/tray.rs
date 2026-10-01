use std::sync::Mutex;
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    utils::config::WindowConfig,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

#[derive(Default)]
pub struct TrayMenuState {
    pub ready: bool,
    pub position: Option<PhysicalPosition<f64>>,
}

pub fn remove(app: &AppHandle) {
    app.remove_tray_by_id("izci");
    if let Some(window) = app.get_webview_window("tray-menu") {
        let _ = crate::window_resources::hide(&window);
    }
    if let Some(window) = app.get_webview_window("tray-bubble") {
        let _ = crate::window_resources::hide(&window);
        let _ = window.emit("izci:desktop-tray-bubble-dismiss", ());
    }
}

// Create utility WebViews before the playback owner starts its JavaScript.
// Building one while window.open creates another can reenter Tauri's locked
// WebContext store through WebView2's controller-creation message pump.
pub fn create_menu(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("tray-menu").is_some() {
        return Ok(());
    }
    let config = WindowConfig {
        label: "tray-menu".into(),
        title: "izci".into(),
        url: tauri::WebviewUrl::App("tray-menu.html".into()),
        width: 300.0,
        height: 512.0,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: false,
        resizable: false,
        skip_taskbar: true,
        always_on_top: true,
        use_https_scheme: true,
        drag_drop_enabled: false,
        background_color: Some(tauri::webview::Color(0, 0, 0, 0)),
        ..Default::default()
    };
    let window = crate::windows::builder(app, &config)?.build()?;
    // This is a menu surface: DWM must not animate either showing or hiding it,
    // including the native focus-loss dismissal path.
    let disabled = ::windows::core::BOOL::from(true);
    unsafe {
        ::windows::Win32::Graphics::Dwm::DwmSetWindowAttribute(
            window.hwnd()?,
            ::windows::Win32::Graphics::Dwm::DWMWA_TRANSITIONS_FORCEDISABLED,
            std::ptr::from_ref(&disabled).cast(),
            std::mem::size_of_val(&disabled) as u32,
        )
    }
    .map_err(|error| std::io::Error::other(error.to_string()))?;
    Ok(())
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopShowIn {
    Taskbar,
    Tray,
    Both,
}

#[tauri::command]
pub async fn configure_desktop_visibility(
    app: AppHandle,
    window: WebviewWindow,
    show_in: DesktopShowIn,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the player configures desktop visibility".into());
    }
    // Restore taskbar access before removing the tray; create the tray before
    // hiding the taskbar entry so a failed update always leaves access available.
    if !matches!(show_in, DesktopShowIn::Tray) {
        window
            .set_skip_taskbar(false)
            .map_err(|error| error.to_string())?;
    }
    if matches!(show_in, DesktopShowIn::Taskbar) {
        remove(&app);
        return Ok(());
    }
    if app.tray_by_id("izci").is_some() {
        return window
            .set_skip_taskbar(matches!(show_in, DesktopShowIn::Tray))
            .map_err(|error| error.to_string());
    }
    if app.get_webview_window("tray-menu").is_none() {
        return Err("Tray menu is unavailable".into());
    }
    let icon = app
        .default_window_icon()
        .ok_or("Application icon is unavailable")?
        .clone();
    TrayIconBuilder::with_id("izci")
        .icon(icon)
        .tooltip("izci")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|icon, event| {
            let app = icon.app_handle();
            match event {
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    position,
                    ..
                } => {
                    let ready = if let Ok(mut state) = app.state::<Mutex<TrayMenuState>>().lock() {
                        state.position = Some(position);
                        state.ready
                    } else {
                        false
                    };
                    if ready {
                        let _ = app.emit_to("tray-menu", "izci:desktop-tray-open", ());
                    }
                }
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    let _ = activate_player(app, false);
                }
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    let _ = activate_player(app, true);
                }
                _ => {}
            }
        })
        .build(&app)
        .map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(matches!(show_in, DesktopShowIn::Tray))
        .map_err(|error| error.to_string())
}

pub fn activate_player(app: &AppHandle, double_click: bool) -> Result<(), String> {
    if double_click {
        crate::windows::restore_main(app)
    } else if crate::player_windows::mini_active(app) {
        crate::player_windows::activate_mini(app)
    } else {
        Ok(())
    }
}

fn require_menu(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "tray-menu" {
        Ok(())
    } else {
        Err("Only the tray menu can present itself".into())
    }
}

#[tauri::command]
pub fn desktop_tray_menu_ready(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, Mutex<TrayMenuState>>,
) -> Result<(), String> {
    require_menu(&window)?;
    let pending = {
        let mut state = state.lock().map_err(|error| error.to_string())?;
        state.ready = true;
        state.position.is_some()
    };
    if pending {
        app.emit_to("tray-menu", "izci:desktop-tray-open", ())
            .map_err(|error| error.to_string())?;
    }
    crate::window_resources::set_active(&window, false);
    Ok(())
}

fn clamp_popup(
    anchor: (f64, f64),
    size: (u32, u32),
    area: (i32, i32, u32, u32),
) -> PhysicalPosition<i32> {
    let (left, top, width, height) = area;
    PhysicalPosition::new(
        (anchor.0 as i32).clamp(
            left,
            left.saturating_add(width.saturating_sub(size.0) as i32),
        ),
        (anchor.1 as i32 - size.1 as i32).clamp(
            top,
            top.saturating_add(height.saturating_sub(size.1) as i32),
        ),
    )
}

#[tauri::command]
pub fn show_desktop_tray_menu(
    app: AppHandle,
    window: WebviewWindow,
    width: f64,
    height: f64,
    state: tauri::State<'_, Mutex<TrayMenuState>>,
) -> Result<(), String> {
    require_menu(&window)?;
    if !width.is_finite() || !height.is_finite() {
        return Err("Invalid tray menu dimensions".into());
    }
    if app.tray_by_id("izci").is_none() {
        return Ok(());
    }
    let position = state
        .lock()
        .map_err(|error| error.to_string())?
        .position
        .ok_or("Tray menu has no anchor")?;
    let monitor = app
        .monitor_from_point(position.x, position.y)
        .map_err(|error| error.to_string())?
        .ok_or("Monitor is unavailable")?;
    let area = monitor.work_area();
    let width =
        ((width.clamp(120.0, 800.0) * monitor.scale_factor()).ceil() as u32).min(area.size.width);
    let height = ((height.clamp(100.0, 1000.0) * monitor.scale_factor()).ceil() as u32)
        .min(area.size.height);
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(clamp_popup(
            (position.x, position.y),
            (width, height),
            (
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
            ),
        ))
        .map_err(|error| error.to_string())?;
    crate::window_resources::show(&window)?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn hide_desktop_tray_menu(window: WebviewWindow) -> Result<(), String> {
    require_menu(&window)?;
    crate::window_resources::hide(&window)
}

#[cfg(test)]
mod tests {
    #[test]
    fn menu_stays_in_work_area_on_high_dpi_and_negative_coordinate_monitors() {
        assert_eq!(
            super::clamp_popup((1910.0, 1040.0), (400, 600), (0, 0, 1920, 1040)),
            tauri::PhysicalPosition::new(1520, 440)
        );
        assert_eq!(
            super::clamp_popup((-1910.0, 10.0), (300, 350), (-1920, 0, 1920, 1040)),
            tauri::PhysicalPosition::new(-1910, 0)
        );
    }
}
