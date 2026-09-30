use std::{collections::HashMap, sync::Mutex};
use tauri::{Manager, Window};
use windows::Win32::{
    Foundation::RECT,
    UI::WindowsAndMessaging::{
        GetWindowPlacement, SetWindowPlacement, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, SW_SHOWNORMAL,
        WINDOWPLACEMENT, WPF_RESTORETOMAXIMIZED,
    },
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const KEY: &str = "Software\\izci\\WindowState";
// Native workspace coordinates, plus the normal/maximized launch state.
type Placement = [i32; 5];

#[derive(Default)]
pub struct WindowState(Mutex<HashMap<String, Placement>>);

fn minimum_size(label: &str) -> Option<(i64, i64)> {
    match label {
        "main" => Some((240, 240)),
        "mini-player" => Some((320, 76)),
        _ => None,
    }
}

fn launch_state(placement: &WINDOWPLACEMENT) -> i32 {
    if placement.showCmd == SW_SHOWMAXIMIZED.0 as u32
        || (placement.showCmd == SW_SHOWMINIMIZED.0 as u32
            && placement.flags.contains(WPF_RESTORETOMAXIMIZED))
    {
        SW_SHOWMAXIMIZED.0
    } else {
        SW_SHOWNORMAL.0
    }
}

fn decode(label: &str, value: &str) -> Option<Placement> {
    let (width, height) = minimum_size(label)?;
    let placement: Placement = serde_json::from_str(value).ok()?;
    let [left, top, right, bottom, show] = placement;
    (i64::from(right) - i64::from(left) >= width
        && i64::from(bottom) - i64::from(top) >= height
        && (show == 1 || (label == "main" && show == 3)))
        .then_some(placement)
}

// Retain the last ordinary placement in memory while Oda/video is fullscreen.
pub fn capture(window: &Window) {
    if minimum_size(window.label()).is_none()
        || window.is_fullscreen().unwrap_or(true)
        || window.is_minimized().unwrap_or(true)
        || !window.is_visible().unwrap_or(false)
    {
        return;
    }
    let Ok(hwnd) = window.hwnd() else { return };
    let mut placement = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };
    if unsafe { GetWindowPlacement(hwnd, &mut placement) }.is_err() {
        return;
    }
    let rect = placement.rcNormalPosition;
    if let Ok(mut state) = window.app_handle().state::<WindowState>().0.lock() {
        state.insert(
            window.label().into(),
            [
                rect.left,
                rect.top,
                rect.right,
                rect.bottom,
                launch_state(&placement),
            ],
        );
    }
}

pub fn save(window: &Window) {
    if minimum_size(window.label()).is_none() {
        return;
    }
    capture(window);
    let state = window.app_handle().state::<WindowState>();
    let Ok(placement) = state.0.lock() else {
        return;
    };
    let Some(placement) = placement.get(window.label()) else {
        return;
    };
    let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(KEY) else {
        return;
    };
    if let Ok(value) = serde_json::to_string(&placement) {
        let _ = key.set_value(window.label(), &value);
    }
}

// Called once the frontend is ready, so restoring never exposes a blank window.
pub fn restore(window: &Window) {
    if minimum_size(window.label()).is_none() {
        return;
    }
    // Reopening a hidden player within the session uses its latest placement.
    let cached = window
        .app_handle()
        .state::<WindowState>()
        .0
        .lock()
        .ok()
        .and_then(|state| state.get(window.label()).copied());
    let saved = cached.or_else(|| {
        let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey(KEY).ok()?;
        let value = key.get_value::<String, _>(window.label()).ok()?;
        decode(window.label(), &value)
    });
    let Some([left, top, right, bottom, show]) = saved else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else { return };
    let placement = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        showCmd: show as u32,
        rcNormalPosition: RECT {
            left,
            top,
            right,
            bottom,
        },
        ..Default::default()
    };
    // Windows also brings a saved rectangle back onscreen after monitor changes.
    let _ = unsafe { SetWindowPlacement(hwnd, &placement) };
    // The mini player has a fixed layout. Restore its position, but use the
    // current configured size rather than keeping a saved oversized surface.
    if window.label() == "mini-player" {
        if let Some(config) = window
            .app_handle()
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == window.label())
        {
            let _ = window.set_size(tauri::LogicalSize::new(config.width, config.height));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_placement_accepts_negative_monitor_coordinates_and_rejects_invalid_data() {
        assert_eq!(
            decode("main", "[-1120,40,0,800,3]"),
            Some([-1120, 40, 0, 800, 3])
        );
        assert_eq!(
            decode("main", "[40,40,280,280,1]"),
            Some([40, 40, 280, 280, 1])
        );
        for value in [
            "invalid",
            "[0,0,10,10,1]",
            "[40,40,279,280,1]",
            "[0,0,1120,760,2]",
            "[0,0,1120,760]",
        ] {
            assert_eq!(decode("main", value), None);
        }
    }

    #[test]
    fn mini_player_placement_accepts_its_short_height_and_negative_coordinates() {
        assert_eq!(
            decode("mini-player", "[-350,-100,0,0,1]"),
            Some([-350, -100, 0, 0, 1])
        );
        assert_eq!(
            decode("mini-player", "[40,40,360,116,1]"),
            Some([40, 40, 360, 116, 1])
        );
        for value in ["[0,0,319,76,1]", "[0,0,350,75,1]", "[0,0,350,76,3]"] {
            assert_eq!(decode("mini-player", value), None);
        }
        assert_eq!(decode("popup-1", "[0,0,350,100,1]"), None);
    }

    #[test]
    fn minimized_launches_restore_the_previous_normal_or_maximized_state() {
        let mut placement = WINDOWPLACEMENT {
            showCmd: SW_SHOWMINIMIZED.0 as u32,
            ..Default::default()
        };
        assert_eq!(launch_state(&placement), SW_SHOWNORMAL.0);
        placement.flags = WPF_RESTORETOMAXIMIZED;
        assert_eq!(launch_state(&placement), SW_SHOWMAXIMIZED.0);
        placement.showCmd = SW_SHOWMAXIMIZED.0 as u32;
        placement.flags = Default::default();
        assert_eq!(launch_state(&placement), SW_SHOWMAXIMIZED.0);
    }
}
