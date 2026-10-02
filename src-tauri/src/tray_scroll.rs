use std::{cell::RefCell, sync::mpsc};
use tauri::{AppHandle, Emitter, Rect};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::{
        CallNextHookEx, SetWindowsHookExW, UnhookWindowsHookEx, HHOOK, MSLLHOOKSTRUCT, WH_MOUSE_LL,
        WM_MOUSEMOVE, WM_MOUSEWHEEL,
    },
};

// Windows sends no wheel notifications to tray icons. Install a short-lived
// hook on Tauri's message-loop thread only while our icon is hovered.
thread_local! {
    static HOVER: RefCell<Option<Hover>> = const { RefCell::new(None) };
}

struct Hover {
    hook: HHOOK,
    dispatch: mpsc::Sender<i32>,
    bounds: (i32, i32, u32, u32),
    remainder: i32,
}

impl Drop for Hover {
    fn drop(&mut self) {
        unsafe {
            let _ = UnhookWindowsHookEx(self.hook);
        }
    }
}

fn contains(bounds: (i32, i32, u32, u32), x: i32, y: i32) -> bool {
    let (left, top, width, height) = bounds;
    x >= left
        && y >= top
        && (x as i64) < left as i64 + width as i64
        && (y as i64) < top as i64 + height as i64
}

fn notches(remainder: &mut i32, delta: i32) -> i32 {
    *remainder += delta;
    let steps = *remainder / 120;
    *remainder %= 120;
    steps
}

unsafe extern "system" fn mouse_hook(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code >= 0 && matches!(message.0 as u32, WM_MOUSEMOVE | WM_MOUSEWHEEL) {
        let mouse = &*(data.0 as *const MSLLHOOKSTRUCT);
        let handled = HOVER.with(|state| {
            let Ok(mut state) = state.try_borrow_mut() else {
                return false;
            };
            let Some(hover) = state.as_mut() else {
                return false;
            };
            if !contains(hover.bounds, mouse.pt.x, mouse.pt.y) {
                // Do not rely on the shell's delayed Leave notification.
                *state = None;
                return false;
            }
            if message.0 != WM_MOUSEWHEEL as usize {
                return false;
            }
            let steps = notches(&mut hover.remainder, (mouse.mouseData >> 16) as i16 as i32);
            // Leave IPC/serialization out of the time-sensitive hook callback.
            if steps != 0 && hover.dispatch.send(steps).is_err() {
                return false;
            }
            true
        });
        // Consume only wheel input over our icon, including partial notches.
        if handled {
            return LRESULT(1);
        }
    }
    CallNextHookEx(None, code, message, data)
}

fn install(app: AppHandle, bounds: (i32, i32, u32, u32)) -> Result<Hover, String> {
    let hook = unsafe {
        GetModuleHandleW(None).and_then(|module| {
            SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), Some(module.into()), 0)
        })
    }
    .map_err(|error| error.to_string())?;
    let (dispatch, receive) = mpsc::channel();
    let hover = Hover {
        hook,
        dispatch,
        bounds,
        remainder: 0,
    };
    // Preserve wheel ordering without performing WebView work inside the hook.
    // Dropping Hover closes the channel; the worker drains and exits without a
    // main-thread join that could deadlock native window dispatch.
    std::thread::Builder::new()
        .name("izci-tray-volume".into())
        .spawn(move || {
            for steps in receive {
                if app.tray_by_id("izci").is_some() {
                    let _ = app.emit_to("main", "izci:desktop-tray-volume-step", steps);
                }
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(hover)
}

pub fn hover(app: &AppHandle, rect: Option<Rect>) {
    let owner = app.clone();
    let _ = app.run_on_main_thread(move || {
        HOVER.with(|state| {
            let mut state = state.borrow_mut();
            let bounds = rect.and_then(|rect| match (rect.position, rect.size) {
                (tauri::Position::Physical(p), tauri::Size::Physical(s))
                    if s.width > 0 && s.height > 0 =>
                {
                    Some((p.x, p.y, s.width, s.height))
                }
                _ => None,
            });
            let Some(bounds) = bounds.filter(|_| owner.tray_by_id("izci").is_some()) else {
                *state = None;
                return;
            };
            if let Some(hover) = state.as_mut() {
                hover.bounds = bounds;
                return;
            }
            match install(owner, bounds) {
                Ok(hover) => *state = Some(hover),
                Err(error) => eprintln!("Could not enable tray volume scrolling: {error}"),
            }
        })
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_physical_bounds_on_negative_monitors() {
        let bounds = (-100, -40, 24, 32);
        assert!(contains(bounds, -100, -40));
        assert!(contains(bounds, -77, -9));
        assert!(!contains(bounds, -76, -9));
        assert!(!contains(bounds, -77, -8));
        assert!(!contains(bounds, -101, -40));
    }

    #[test]
    fn accumulates_high_resolution_wheel_input_in_both_directions() {
        let mut remainder = 0;
        assert_eq!(notches(&mut remainder, 60), 0);
        assert_eq!(notches(&mut remainder, 60), 1);
        assert_eq!(notches(&mut remainder, -30), 0);
        assert_eq!(notches(&mut remainder, -210), -2);
        assert_eq!(remainder, 0);
    }
}
