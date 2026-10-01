use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum WindowRole {
    #[default]
    Utility,
    Options,
    Workbench,
    WorkbenchOptions,
}

impl WindowRole {
    pub fn from_path(path: &str) -> Self {
        match path.trim_start_matches('/') {
            "options.html" => Self::Options,
            "troubadour.html" => Self::Workbench,
            "troubadour-options.html" => Self::WorkbenchOptions,
            _ => Self::Utility,
        }
    }

    pub fn reusable(self) -> bool {
        matches!(self, Self::Options | Self::WorkbenchOptions)
    }
}

// Remember roles while windows navigate. Close/Destroyed callbacks must not
// ask a disappearing WebView2 controller for its URL.
#[derive(Default)]
pub struct WindowLifecycle(pub Mutex<HashMap<String, WindowRole>>);

pub fn record(app: &AppHandle, label: &str, role: WindowRole) {
    if let Ok(mut roles) = app.state::<WindowLifecycle>().0.lock() {
        roles.insert(label.into(), role);
    }
}

pub fn role(window: &WebviewWindow) -> WindowRole {
    window
        .app_handle()
        .state::<WindowLifecycle>()
        .0
        .lock()
        .ok()
        .and_then(|roles| roles.get(window.label()).copied())
        .unwrap_or_default()
}

fn preserve(role: WindowRole, workbench_open: bool) -> bool {
    workbench_open && matches!(role, WindowRole::Workbench | WindowRole::WorkbenchOptions)
}

pub fn close_player(app: &AppHandle) {
    #[cfg(feature = "builtin-signaling")]
    crate::signaling_transport::stop(app);
    #[cfg(feature = "builtin-signaling")]
    crate::signaling::stop(app, None);
    for label in ["main", "mini-player"] {
        if let Some(window) = app.get_webview_window(label) {
            crate::window_state::save(&window.as_ref().window());
        }
    }
    let roles = app
        .state::<WindowLifecycle>()
        .0
        .lock()
        .map(|roles| roles.clone())
        .unwrap_or_default();
    let windows = app.webview_windows();
    let workbench_open = windows
        .keys()
        .any(|label| roles.get(label) == Some(&WindowRole::Workbench));
    // Destroy the playback owner and its utilities, bypassing browser close
    // interception. A real Troubadour window can still finish its write jobs.
    for (label, window) in windows {
        if !preserve(
            roles.get(&label).copied().unwrap_or_default(),
            workbench_open,
        ) {
            let _ = window.destroy();
        }
    }
    if !workbench_open {
        app.exit(0);
    }
}

pub fn destroyed(app: &AppHandle, label: &str) {
    let finished = if let Ok(mut roles) = app.state::<WindowLifecycle>().0.lock() {
        roles.remove(label);
        !roles.contains_key("main") && !roles.values().any(|role| *role == WindowRole::Workbench)
    } else {
        false
    };
    if finished {
        app.exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::{preserve, WindowRole};

    #[test]
    fn hidden_settings_and_player_utilities_do_not_keep_playback_alive() {
        for path in [
            "index.html",
            "mini-player.html",
            "tray-menu.html",
            "options.html",
            "troubadour-options.html",
        ] {
            assert!(!preserve(WindowRole::from_path(path), false));
        }
    }

    #[test]
    fn only_an_open_workbench_and_its_options_survive_player_close() {
        assert!(preserve(WindowRole::from_path("/troubadour.html"), true));
        assert!(preserve(
            WindowRole::from_path("/troubadour-options.html"),
            true
        ));
        assert!(!preserve(WindowRole::Options, true));
        assert!(!preserve(WindowRole::Utility, true));
    }
}
