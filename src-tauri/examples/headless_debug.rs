//! Resident hidden packaged runtime. Only copied profiles and local file IPC.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod associations {
    pub fn formats() -> std::collections::BTreeMap<String, String> {
        serde_json::from_str(include_str!("../media-formats.json")).unwrap()
    }
}
#[allow(dead_code)]
#[path = "../src/desktop_files.rs"]
mod desktop_files;
#[allow(dead_code)]
#[path = "../src/fonts.rs"]
mod fonts;
#[path = "support/headless_control.rs"]
mod headless_control;
#[path = "../src/playback_restoration.rs"]
mod playback_restoration;
#[path = "../src/signaling.rs"]
mod signaling;
#[path = "../src/signaling_transport.rs"]
#[allow(dead_code)]
mod signaling_transport;
mod windows {
    pub fn is_app_url(url: &tauri::Url) -> bool {
        url.scheme() == "https" && url.host_str() == Some("tauri.localhost")
    }
}

use ::windows::core::Interface;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;

struct Session {
    directory: PathBuf,
    ready: AtomicBool,
    muted: Arc<AtomicBool>,
}

#[tauri::command]
fn desktop_window_ready(
    window: WebviewWindow,
    state: tauri::State<'_, Session>,
) -> Result<(), String> {
    if window.label() == "main" && !state.ready.swap(true, Ordering::Relaxed) {
        headless_control::write_json(&state.directory.join("ready.json"), &serde_json::json!({
            "pid": std::process::id(), "origin": "https://tauri.localhost",
            "visible": window.is_visible().unwrap_or(true), "muted": state.muted.load(Ordering::Relaxed)
        })).map_err(|error| error.to_string())?;
    }
    Ok(())
}

// Keep the real runtime's shell calls inert. No registry, tray, focus, or OS UI.
#[tauri::command]
fn configure_desktop_associations() {}
#[tauri::command]
fn configure_desktop_visibility() {}
#[tauri::command]
fn present_desktop_popup() {}
#[tauri::command]
fn open_desktop_default_apps() {}
#[tauri::command]
fn open_mini_player() {}
#[tauri::command]
fn close_mini_player() {}
#[tauri::command]
fn dismiss_mini_player() {}
#[tauri::command]
fn restore_main_window() {}
#[tauri::command]
fn pin_mini_player() {}
#[tauri::command]
fn exit_desktop(window: WebviewWindow) {
    window.app_handle().exit(0);
}

const INITIALIZE: &str = r#"(() => {
    window.__izciHeadless = true;
    // Change only the disposable copy. Preserve the saved position for probes.
    try {
        const checkpoint = JSON.parse(localStorage.getItem('izci.playback-restoration') || 'null');
        if (checkpoint) localStorage.setItem('izci.playback-restoration', JSON.stringify({...checkpoint, wasPlaying: false}));
        const multiplayer = JSON.parse(localStorage.getItem('izci.multiplayer-settings') || '{}');
        localStorage.setItem('izci.multiplayer-settings', JSON.stringify({...multiplayer, multiplayer: false, multiplayerRestoreLastSession: false}));
    } catch {}
    // Hidden testing must not take ownership of the user's media keys/metadata.
    Object.defineProperty(navigator, 'mediaSession', {value: {
        metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {}
    }, configurable: true});
})()"#;

fn main() {
    let directory = PathBuf::from(std::env::args().nth(1).expect("Session directory required"))
        .canonicalize()
        .unwrap();
    let sessions = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".local/desktop-headless/sessions")
        .canonicalize()
        .unwrap();
    assert!(
        directory.starts_with(&sessions) && directory != sessions,
        "Use a workspace-local headless session"
    );
    let profile = directory.join("profile").canonicalize().unwrap();
    assert!(
        profile.starts_with(&directory) && profile.join("EBWebView/Default").is_dir(),
        "Use a copied profile inside the session"
    );
    tauri::Builder::default()
        .manage(Session { directory: directory.clone(), ready: AtomicBool::new(false), muted: Arc::new(AtomicBool::new(false)) })
        .manage(desktop_files::LaunchFiles::default())
        .manage(signaling::Signaling::default())
        .manage(signaling_transport::Transport::default())
        .invoke_handler(tauri::generate_handler![
            desktop_window_ready, configure_desktop_associations, configure_desktop_visibility,
            present_desktop_popup, open_desktop_default_apps, open_mini_player,
            close_mini_player, dismiss_mini_player, restore_main_window, pin_mini_player, exit_desktop,
            playback_restoration::prepare_desktop_playback_restoration,
            desktop_files::take_desktop_launch_paths, desktop_files::materialize_desktop_files,
            fonts::local_font_families,
            signaling::start_builtin_signaling, signaling::stop_builtin_signaling,
            signaling_transport::signaling_http, signaling_transport::cancel_signaling_http,
            signaling_transport::open_signaling_socket, signaling_transport::send_signaling_socket
        ])
        .setup(move |app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .use_https_scheme(true).visible(false).skip_taskbar(true).focused(false)
                .data_directory(profile).initialization_script(INITIALIZE)
                .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --mute-audio")
                .on_navigation(|url| windows::is_app_url(url))
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_permission_request(|webview, kind| {
                    if kind == tauri::webview::PermissionKind::FileSystemAccess && webview.url().is_ok_and(|url| windows::is_app_url(&url)) {
                        tauri::webview::PermissionResponse::Allow
                    } else { tauri::webview::PermissionResponse::Default }
                }).build()?;
            let muted = app.state::<Session>().muted.clone();
            window.with_webview(move |webview| unsafe {
                if webview.controller().CoreWebView2().and_then(|core| core.cast::<ICoreWebView2_8>()).and_then(|core| core.SetIsMuted(true)).is_ok() {
                    muted.store(true, Ordering::Relaxed);
                }
            })?;
            headless_control::start(window, directory);
            Ok(())
        })
        .run(tauri::generate_context!()).expect("Headless izci runtime");
}
