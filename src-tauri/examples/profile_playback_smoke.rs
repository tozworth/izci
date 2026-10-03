//! Start the packaged player against an explicitly supplied copied profile.
//! Shell commands are inert: no registry writes, tray changes, or visible windows.
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
#[path = "../src/playback_restoration.rs"]
mod playback_restoration;
mod windows {
    pub fn is_app_url(url: &tauri::Url) -> bool {
        url.scheme() == "https" && url.host_str() == Some("tauri.localhost")
    }
}

use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn desktop_window_ready() {}
#[tauri::command]
fn configure_desktop_associations() {}
#[tauri::command]
fn configure_desktop_autostart() {}
#[tauri::command]
fn configure_desktop_visibility() {}

static CHECKING: AtomicBool = AtomicBool::new(false);
const SNAPSHOT: &str = r#"(async () => {
    // This is the application's Howler HTML5 backend, not a test audio element.
    const howls = window.Howler?._howls || [];
    const sounds = howls.map(h => ({state: h.state(), playing: h.playing(),
        position: h.seek(), duration: h.duration(), html5: h._html5,
        media: h._sounds.map(s => ({readyState: s._node?.readyState, paused: s._node?.paused}))}));
    const checkpoint = JSON.parse(localStorage.getItem('izci.playback-restoration') || 'null');
    return {sounds, checkpoint, initialCheckpoint: window.initialCheckpoint};
})()"#;

fn main() {
    let directory = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("Copied profile root required"),
    );
    assert!(
        directory.join("EBWebView/Default").is_dir(),
        "Expected a copied profile"
    );
    assert!(
        directory.canonicalize().unwrap().starts_with(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join(".local")
                .canonicalize()
                .unwrap()
        ),
        "Use a workspace-local profile copy"
    );
    tauri::Builder::default()
        .manage(desktop_files::LaunchFiles::default())
        .invoke_handler(tauri::generate_handler![
            desktop_window_ready, configure_desktop_associations, configure_desktop_autostart, configure_desktop_visibility,
            playback_restoration::prepare_desktop_playback_restoration,
            desktop_files::take_desktop_launch_paths, desktop_files::materialize_desktop_files,
            desktop_files::configure_desktop_file_launch,
            fonts::local_font_families
        ])
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .use_https_scheme(true).visible(false).data_directory(directory)
                .initialization_script("window.initialCheckpoint = JSON.parse(localStorage.getItem('izci.playback-restoration') || 'null');")
                .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows")
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_page_load(|window, payload| {
                    if payload.event() != tauri::webview::PageLoadEvent::Finished || CHECKING.swap(true, Ordering::Relaxed) { return; }
                    let window = window.clone();
                    tauri::async_runtime::spawn(async move {
                        // Wait through real queue hydration, FSA restoration, metadata,
                        // Howler loading, seeking, and several progress checkpoints.
                        let result = desktop_files::devtools(&window, "Runtime.evaluate", serde_json::json!({
                            "expression": format!("new Promise(resolve => setTimeout(async () => resolve(await {SNAPSHOT}), 8000))"),
                            "awaitPromise": true, "returnByValue": true
                        })).await;
                        println!("{}", serde_json::to_string_pretty(&result).unwrap());
                        let initial_position = result.as_ref().ok().and_then(|v| v.pointer("/result/value/initialCheckpoint/currentTime")).and_then(|v| v.as_f64()).unwrap_or(f64::INFINITY);
                        let playing = result.as_ref().ok().and_then(|v| v.pointer("/result/value/sounds")).and_then(|v| v.as_array())
                            .is_some_and(|sounds| sounds.iter().any(|sound| sound["playing"] == true && sound["html5"] == true && sound["position"].as_f64().unwrap_or(0.0) > initial_position));
                        window.app_handle().exit(if playing {0} else {1});
                    });
                }).build()?;
            Ok(())
        }).run(tauri::generate_context!()).expect("Copied profile playback smoke");
}
