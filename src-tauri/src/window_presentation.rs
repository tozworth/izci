use std::{collections::HashSet, sync::Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Default)]
pub struct WindowPresentation {
    ready: HashSet<String>,
    requested: HashSet<String>,
}

impl WindowPresentation {
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
pub fn desktop_window_ready(
    window: WebviewWindow,
    state: tauri::State<'_, Mutex<WindowPresentation>>,
) -> Result<(), String> {
    let initially_visible = window.label() != "mini-player"
        && window
            .url()
            .is_ok_and(|url| !url.query_pairs().any(|(key, _)| key == "desktop-prewarm"));
    let show = state
        .lock()
        .map_err(|error| error.to_string())?
        .ready(window.label(), initially_visible);
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
    use super::WindowPresentation;

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
