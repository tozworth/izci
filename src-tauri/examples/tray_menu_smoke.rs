//! Exercises the packaged tray page with rendering disabled, as it is between opens.
//! Uses a disposable profile and never creates a tray icon or player window.
#[allow(dead_code)]
#[path = "../src/window_resources.rs"]
mod window_resources;

use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
struct Smoke {
    presentations: AtomicUsize,
}

#[tauri::command]
fn show_desktop_tray_menu(
    window: WebviewWindow,
    state: tauri::State<'_, Smoke>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width <= 12.0 || height <= 12.0 {
        return Err("Invalid popup dimensions".into());
    }
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    // Restore controller rendering as production does, but keep the test HWND hidden.
    window_resources::set_active(&window, true);
    state.presentations.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn hide_desktop_tray_menu(window: WebviewWindow) {
    window_resources::set_active(&window, false);
}

#[tauri::command]
fn smoke_snapshot(
    window: WebviewWindow,
    state: tauri::State<'_, Smoke>,
    snapshot: serde_json::Value,
) {
    let phase = snapshot["phase"].as_str().unwrap_or_default();
    let presentations = state.presentations.load(Ordering::SeqCst);
    let success = presentations > 0
        && snapshot["menu"] == true
        && snapshot["errors"] == serde_json::json!([])
        && match phase {
            "open" | "reopen" => snapshot["raf"] == true,
            "raf" => snapshot["back"] == true && snapshot["bypass"] == true,
            _ => false,
        };
    println!("Tray {phase}: native presentations={presentations}, {snapshot}");
    if !success {
        eprintln!("Tray smoke failed while {phase}");
        window.app_handle().exit(1);
    } else if phase == "reopen" {
        println!("Verified: hidden tray opens, shares Raf controls, and reopens after dismissal.");
        window.app_handle().exit(0);
    }
}

fn snapshot(window: &WebviewWindow, phase: &str) {
    let expression = format!(
        r#"window.__TAURI_INTERNALS__.invoke('smoke_snapshot', {{ snapshot: {{
            phase: {phase:?}, menu: !!document.querySelector('.tray-menu'),
            raf: !!document.querySelector('[data-tray-raf]'),
            back: !!document.querySelector('.tray-back'),
            bypass: [...document.querySelectorAll('button')].some(button => button.textContent.includes('Bypass Raf')),
            visibility: document.visibilityState, frames: window.__smokeFrames,
            errors: window.__smokeErrors
        }} }})"#
    );
    let _ = window.eval(expression);
}

#[tauri::command]
fn desktop_tray_menu_ready(window: WebviewWindow) {
    window_resources::set_active(&window, false);
    std::thread::spawn(move || {
        let pause = || std::thread::sleep(std::time::Duration::from_millis(500));
        pause();
        let _ = window.emit("izci:desktop-tray-open", ());
        pause();
        snapshot(&window, "open");
        pause();
        let _ = window.eval("document.querySelector('[data-tray-raf]')?.click()");
        pause();
        snapshot(&window, "raf");
        pause();
        window_resources::set_active(&window, false);
        let _ = window.emit("izci:desktop-tray-dismiss", ());
        pause();
        let _ = window.emit("izci:desktop-tray-open", ());
        pause();
        snapshot(&window, "reopen");
    });
}

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = format!("app.izci.traysmoke{}", std::process::id());
    let profile = std::env::temp_dir().join(format!("izci-tray-smoke-{}", std::process::id()));
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(15));
        eprintln!("Tray smoke timed out; packaged page or IPC did not become ready.");
        std::process::exit(2);
    });
    tauri::Builder::default()
        .manage(Smoke::default())
        .invoke_handler(tauri::generate_handler![
            desktop_tray_menu_ready,
            show_desktop_tray_menu,
            hide_desktop_tray_menu,
            smoke_snapshot
        ])
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "tray-menu", WebviewUrl::App("tray-menu.html".into()))
                .use_https_scheme(true)
                .visible(false)
                .skip_taskbar(true)
                .focused(false)
                .data_directory(profile)
                .additional_browser_args("--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --mute-audio")
                .initialization_script(r#"
                    localStorage.setItem('izci.locale', JSON.stringify('en'));
                    localStorage.setItem('izci.raf-settings', JSON.stringify({enabled: true, effects: []}));
                    window.__smokeFrames = 0;
                    window.__smokeErrors = [];
                    const frame = window.requestAnimationFrame.bind(window);
                    window.requestAnimationFrame = callback => frame(time => { ++window.__smokeFrames; callback(time); });
                    window.addEventListener('error', event => window.__smokeErrors.push(event.message));
                    window.addEventListener('unhandledrejection', event => window.__smokeErrors.push(String(event.reason)));
                "#)
                .build()?;
            Ok(())
        })
        .run(context)
        .expect("Tray menu smoke runtime");
}
