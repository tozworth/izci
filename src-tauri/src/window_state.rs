use std::sync::Mutex;
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
pub struct WindowState(Mutex<Option<Placement>>);

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

fn decode(value: &str) -> Option<Placement> {
    let placement: Placement = serde_json::from_str(value).ok()?;
    let [left, top, right, bottom, show] = placement;
    (i64::from(right) - i64::from(left) >= 320
        && i64::from(bottom) - i64::from(top) >= 240
        && matches!(show, 1 | 3))
    .then_some(placement)
}

// Retain the last ordinary placement in memory while Oda/video is fullscreen.
pub fn capture(window: &Window) {
    if window.label() != "main"
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
        *state = Some([
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
            launch_state(&placement),
        ]);
    }
}

pub fn save(window: &Window) {
    capture(window);
    let state = window.app_handle().state::<WindowState>();
    let Ok(placement) = state.0.lock() else {
        return;
    };
    let Some(placement) = *placement else { return };
    let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(KEY) else {
        return;
    };
    if let Ok(value) = serde_json::to_string(&placement) {
        let _ = key.set_value("main", &value);
    }
}

// Called once the frontend is ready, so restoring never exposes a blank window.
pub fn restore(window: &Window) {
    if window.label() != "main" {
        return;
    }
    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(KEY) else {
        return;
    };
    let Ok(value) = key.get_value::<String, _>("main") else {
        return;
    };
    let Some([left, top, right, bottom, show]) = decode(&value) else {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_placement_accepts_negative_monitor_coordinates_and_rejects_invalid_data() {
        assert_eq!(decode("[-1120,40,0,800,3]"), Some([-1120, 40, 0, 800, 3]));
        for value in [
            "invalid",
            "[0,0,10,10,1]",
            "[0,0,1120,760,2]",
            "[0,0,1120,760]",
        ] {
            assert_eq!(decode(value), None);
        }
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
