use crate::tray::DesktopShowIn;
use std::{collections::HashSet, sync::Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Default)]
pub struct WindowPresentation {
    ready: HashSet<String>,
    requested: HashSet<String>,
    boot_launch: bool,
}

impl WindowPresentation {
    pub fn new(boot_launch: bool) -> Self {
        Self {
            boot_launch,
            ..Default::default()
        }
    }

    pub fn begin_launch(&mut self, boot_launch: bool) {
        self.boot_launch = boot_launch;
    }

    fn ready_main(&mut self, show_in: DesktopShowIn) -> bool {
        let has_tray = matches!(show_in, DesktopShowIn::Tray | DesktopShowIn::Both);
        let initially_visible = !(std::mem::take(&mut self.boot_launch) && has_tray);
        self.ready("main", initially_visible)
    }

    fn ready(&mut self, label: &str, initially_visible: bool) -> bool {
        self.ready.insert(label.into());
        let requested = self.requested.remove(label);
        initially_visible || requested
    }

    fn request(&mut self, label: &str) -> bool {
        if self.ready.contains(label) {
            true
        } else {
            self.requested.insert(label.into());
            false
        }
    }

    pub fn forget(&mut self, label: &str) {
        self.ready.remove(label);
        self.requested.remove(label);
    }
}

fn present(window: &WebviewWindow) -> Result<(), String> {
    crate::window_resources::show(window)?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn request_main(app: &AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or("Main window is unavailable")?;
    let show = app
        .state::<Mutex<WindowPresentation>>()
        .lock()
        .map_err(|error| error.to_string())?
        .request("main");
    if show {
        crate::windows::restore_main(app)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn desktop_window_ready(
    window: WebviewWindow,
    show_in: crate::tray::DesktopShowIn,
    tray_icon: crate::tray::DesktopTrayIcon,
    state: tauri::State<'_, Mutex<WindowPresentation>>,
) -> Result<(), String> {
    // Establish access through the tray before deciding whether to expose the
    // main HWND. A silent boot never restores placement or calls show/focus.
    let mut launch_show_in = show_in;
    if window.label() == "main" {
        if let Err(error) = crate::tray::configure(window.app_handle(), &window, show_in, tray_icon)
        {
            eprintln!("Could not configure desktop visibility: {error}");
            // A failed tray creation must not leave an inaccessible player.
            launch_show_in = DesktopShowIn::Taskbar;
            let _ = window.set_skip_taskbar(false);
        }
    }
    let initially_visible = window.label() != "mini-player"
        && window
            .url()
            .is_ok_and(|url| !url.query_pairs().any(|(key, _)| key == "desktop-prewarm"));
    let show = {
        let mut state = state.lock().map_err(|error| error.to_string())?;
        if window.label() == "main" {
            state.ready_main(launch_show_in)
        } else {
            state.ready(window.label(), initially_visible)
        }
    };
    if show {
        if window.label() == "main" {
            crate::player_windows::end_mini(window.app_handle())?;
        }
        crate::window_state::restore(&window.as_ref().window());
        present(&window)?;
        crate::window_state::capture(&window.as_ref().window());
    } else {
        crate::window_resources::set_active(&window, false);
    }
    Ok(())
}

#[tauri::command]
pub fn present_desktop_popup(
    app: AppHandle,
    path: String,
    state: tauri::State<'_, Mutex<WindowPresentation>>,
) -> Result<(), String> {
    let popup = app
        .webview_windows()
        .into_values()
        .find(|window| {
            window.label().starts_with("popup-") && window.url().is_ok_and(|url| url.path() == path)
        })
        .ok_or("Tool window is unavailable")?;
    let show = state
        .lock()
        .map_err(|error| error.to_string())?
        .request(popup.label());
    if show {
        present(&popup)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{DesktopShowIn, WindowPresentation};

    #[test]
    fn boot_launch_in_tray_stays_hidden_until_explicitly_requested() {
        for show_in in [DesktopShowIn::Tray, DesktopShowIn::Both] {
            let mut state = WindowPresentation::new(true);
            assert!(!state.ready_main(show_in));
            assert!(state.request("main"));
        }
    }

    #[test]
    fn manual_launch_and_boot_with_taskbar_only_show_the_player() {
        for show_in in [
            DesktopShowIn::Taskbar,
            DesktopShowIn::Tray,
            DesktopShowIn::Both,
        ] {
            assert!(WindowPresentation::new(false).ready_main(show_in));
        }
        assert!(WindowPresentation::new(true).ready_main(DesktopShowIn::Taskbar));
    }

    #[test]
    fn manual_activation_during_silent_boot_waits_for_ready_then_shows() {
        for show_in in [DesktopShowIn::Tray, DesktopShowIn::Both] {
            let mut state = WindowPresentation::new(true);
            assert!(!state.request("main"));
            assert!(state.ready_main(show_in));
        }
    }

    #[test]
    fn recreating_a_closed_player_uses_the_new_launch_intent() {
        let mut state = WindowPresentation::new(false);
        assert!(state.ready_main(DesktopShowIn::Both));
        state.forget("main");
        state.begin_launch(true);
        assert!(!state.ready_main(DesktopShowIn::Both));
        state.forget("main");
        state.begin_launch(false);
        assert!(state.ready_main(DesktopShowIn::Both));
    }

    #[test]
    fn warm_windows_wait_for_a_request_and_reopen_without_reloading() {
        let mut state = WindowPresentation::default();
        assert!(!state.ready("options", false));
        assert!(state.request("options"));
        assert!(state.request("options"));
    }

    #[test]
    fn opening_during_warmup_waits_for_the_content() {
        let mut state = WindowPresentation::default();
        assert!(!state.request("options"));
        assert!(state.ready("options", false));
        state.forget("options");
        assert!(!state.ready("options", false));
    }
}
