use tauri::{
    utils::config::WindowConfig, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize,
    WebviewWindow,
};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("tray-bubble").is_some() {
        return Ok(());
    }
    let config = WindowConfig {
        label: "tray-bubble".into(),
        title: "izci".into(),
        url: tauri::WebviewUrl::App("tray-bubble.html".into()),
        width: 560.0,
        height: 40.0,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: false,
        focus: false,
        focusable: false,
        resizable: false,
        skip_taskbar: true,
        always_on_top: true,
        use_https_scheme: true,
        drag_drop_enabled: false,
        background_color: Some(tauri::webview::Color(0, 0, 0, 0)),
        ..Default::default()
    };
    let window = crate::windows::builder(app, &config)?.build()?;
    window.set_ignore_cursor_events(true)?;
    // CSS owns the short fades. Disable Windows' competing show/hide animation.
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

// Use the work area to locate the taskbar, but clamp to the screen so its
// inset icons can keep the requested gap. All inputs are physical pixels.
fn position(
    icon: (i32, i32, u32, u32),
    size: (u32, u32),
    area: (i32, i32, u32, u32),
    screen: (i32, i32, u32, u32),
    gap: i32,
) -> PhysicalPosition<i32> {
    let (x, y, iw, ih) = icon;
    let (left, top, aw, ah) = area;
    let right = left + aw as i32;
    let bottom = top + ah as i32;
    let cx = x + iw as i32 / 2;
    let cy = y + ih as i32 / 2;
    let distances = [
        (cy - bottom).abs(),
        (cy - top).abs(),
        (cx - left).abs(),
        (cx - right).abs(),
    ];
    let edge = distances
        .iter()
        .enumerate()
        .min_by_key(|(_, distance)| *distance)
        .unwrap()
        .0;
    let (px, py) = match edge {
        0 => (cx - size.0 as i32 / 2, y - size.1 as i32 - gap),
        1 => (cx - size.0 as i32 / 2, y + ih as i32 + gap),
        2 => (x + iw as i32 + gap, cy - size.1 as i32 / 2),
        _ => (x - size.0 as i32 - gap, cy - size.1 as i32 / 2),
    };
    let (left, top, sw, sh) = screen;
    let right = left + sw as i32;
    let bottom = top + sh as i32;
    PhysicalPosition::new(
        px.clamp(left, right - size.0 as i32),
        py.clamp(top, bottom - size.1 as i32),
    )
}

fn require_bubble(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "tray-bubble" {
        Ok(())
    } else {
        Err("Only the track info bubble can present itself".into())
    }
}

fn player_is_focused(app: &AppHandle) -> bool {
    ["main", "mini-player"].iter().any(|label| {
        app.get_webview_window(label).is_some_and(|window| {
            window.is_focused().unwrap_or(false)
                && window.is_visible().unwrap_or(false)
                && !window.is_minimized().unwrap_or(true)
        })
    })
}

pub fn dismiss(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("tray-bubble") {
        let _ = crate::window_resources::hide(&window);
        let _ = window.emit("izci:desktop-tray-bubble-dismiss", ());
    }
}

#[tauri::command]
pub fn show_desktop_track_bubble(
    app: AppHandle,
    window: WebviewWindow,
    width: f64,
    height: f64,
) -> Result<bool, String> {
    require_bubble(&window)?;
    if !width.is_finite() || !height.is_finite() {
        return Err("Invalid bubble dimensions".into());
    }
    if player_is_focused(&app) {
        return Ok(false);
    }
    let Some(icon) = app.tray_by_id("izci") else {
        return Ok(false);
    };
    let Some(rect) = icon.rect().map_err(|error| error.to_string())? else {
        return Ok(false);
    };
    let tauri::Position::Physical(anchor) = rect.position else {
        return Ok(false);
    };
    let tauri::Size::Physical(icon_size) = rect.size else {
        return Ok(false);
    };
    if icon_size.width == 0 || icon_size.height == 0 {
        return Ok(false);
    }
    let cx = anchor.x + icon_size.width as i32 / 2;
    let cy = anchor.y + icon_size.height as i32 / 2;
    let Some(monitor) = app
        .monitor_from_point(cx as f64, cy as f64)
        .map_err(|error| error.to_string())?
    else {
        return Ok(false);
    };
    let bounds = monitor.position();
    let screen = monitor.size();
    // A closed overflow panel can leave an unusable/off-screen rectangle.
    // Do not invent an alternative anchor.
    if cx < bounds.x
        || cy < bounds.y
        || cx >= bounds.x + screen.width as i32
        || cy >= bounds.y + screen.height as i32
    {
        return Ok(false);
    }
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let size = (
        ((width.clamp(40.0, 560.0) * scale).ceil() as u32).min(area.size.width),
        ((height.clamp(20.0, 80.0) * scale).ceil() as u32).min(area.size.height),
    );
    window
        .set_size(PhysicalSize::new(size.0, size.1))
        .map_err(|error| error.to_string())?;
    window
        .set_position(position(
            (anchor.x, anchor.y, icon_size.width, icon_size.height),
            size,
            (
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
            ),
            (bounds.x, bounds.y, screen.width, screen.height),
            (2.0 * scale).round() as i32,
        ))
        .map_err(|error| error.to_string())?;
    if player_is_focused(&app) {
        return Ok(false);
    }
    crate::window_resources::set_active(&window, true);
    // Show without activating either the HWND or its WebView2 controller.
    unsafe {
        let _ = ::windows::Win32::UI::WindowsAndMessaging::ShowWindow(
            window.hwnd().map_err(|error| error.to_string())?,
            ::windows::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE,
        );
    }
    Ok(true)
}

#[tauri::command]
pub fn hide_desktop_track_bubble(window: WebviewWindow) -> Result<(), String> {
    require_bubble(&window)?;
    crate::window_resources::hide(&window)
}

#[cfg(test)]
mod tests {
    use super::position;
    use tauri::PhysicalPosition;

    #[test]
    fn anchors_to_bottom_top_and_side_taskbars() {
        assert_eq!(
            position(
                (1800, 1048, 24, 24),
                (300, 28),
                (0, 0, 1920, 1040),
                (0, 0, 1920, 1080),
                2
            ),
            PhysicalPosition::new(1620, 1018)
        );
        assert_eq!(
            position(
                (900, 8, 24, 24),
                (300, 28),
                (0, 40, 1920, 1040),
                (0, 0, 1920, 1080),
                2
            ),
            PhysicalPosition::new(762, 34)
        );
        assert_eq!(
            position(
                (8, 500, 24, 24),
                (300, 28),
                (40, 0, 1880, 1080),
                (0, 0, 1920, 1080),
                2
            ),
            PhysicalPosition::new(34, 498)
        );
    }

    #[test]
    fn respects_negative_monitors_and_scaled_work_areas() {
        assert_eq!(
            position(
                (-90, 1048, 24, 24),
                (450, 42),
                (-1920, 0, 1920, 1040),
                (-1920, 0, 1920, 1080),
                3
            ),
            PhysicalPosition::new(-450, 1003)
        );
    }
}
