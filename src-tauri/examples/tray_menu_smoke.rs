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
        && snapshot["layout"]
            .as_array()
            .is_some_and(|menus| menus.iter().all(|menu| menu["scrollTopMax"] == 0.0))
        && match phase {
            "open" | "reopen" => snapshot["raf"] == true,
            "raf" => snapshot["back"] == true && snapshot["bypass"] == true,
            "raf-deleted" => snapshot["back"] == true && snapshot["presets"] == 5,
            "raf-bypassed" => snapshot["back"] == true && snapshot["enable"] == true,
            "raf-disabled" => snapshot["raf"] == false && snapshot["back"] == false,
            "raf-restored" => snapshot["raf"] == true,
            _ => false,
        };
    println!("Tray {phase}: native presentations={presentations}, {snapshot}");
    if !success {
        eprintln!("Tray smoke failed while {phase}");
        window.app_handle().exit(1);
    } else if phase == "raf-restored" {
        println!("Verified: hidden tray opens, fits presets before/after deletion, survives bypass, and follows the global Raf switch.");
        window.app_handle().exit(0);
    }
}

fn snapshot(window: &WebviewWindow, phase: &str) {
    let expression = format!(
        r#"window.__TAURI_INTERNALS__.invoke('smoke_snapshot', {{ snapshot: {{
            phase: {phase:?}, menu: !!document.querySelector('.tray-menu'),
            raf: !!document.querySelector('[data-tray-raf]'),
            back: !!document.querySelector('.tray-back'),
            presets: document.querySelectorAll('.menu-surface-nested button').length - 2,
            bypass: [...document.querySelectorAll('button')].some(button => button.textContent.includes('Bypass Raf')),
            enable: [...document.querySelectorAll('button')].some(button => button.textContent.includes('Enable Raf')),
            visibility: document.visibilityState, frames: window.__smokeFrames,
            viewport: {{width: innerWidth, height: innerHeight, dpr: devicePixelRatio}},
            layout: [...document.querySelectorAll('.menu-surface')].map(menu => {{
                const scrollTop = menu.scrollTop;
                menu.scrollTop = 1000000;
                const scrollTopMax = menu.scrollTop;
                menu.scrollTop = scrollTop;
                return ({{
                class: menu.className, height: menu.getBoundingClientRect().height,
                width: menu.getBoundingClientRect().width,
                clientHeight: menu.clientHeight, scrollHeight: menu.scrollHeight,
                clientWidth: menu.clientWidth, scrollWidth: menu.scrollWidth,
                maxHeight: getComputedStyle(menu).maxHeight,
                overflow: getComputedStyle(menu).overflowY, scrollTopMax
            }}); }}),
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
        let _ = window.eval(
            r#"(() => {
            const state = JSON.parse(localStorage.getItem('izci.raf-presets'));
            state.presets.pop();
            localStorage.setItem('izci.raf-presets', JSON.stringify(state));
            window.dispatchEvent(new StorageEvent('storage', {key: 'izci.raf-presets'}));
        })()"#,
        );
        pause();
        snapshot(&window, "raf-deleted");
        pause();
        let _ = window.eval(
            r#"(() => {
            const state = JSON.parse(localStorage.getItem('izci.raf-settings'));
            state.enabled = false;
            localStorage.setItem('izci.raf-settings', JSON.stringify(state));
            window.dispatchEvent(new StorageEvent('storage', {key: 'izci.raf-settings'}));
        })()"#,
        );
        pause();
        snapshot(&window, "raf-bypassed");
        pause();
        window_resources::set_active(&window, false);
        let _ = window.emit("izci:desktop-tray-dismiss", ());
        pause();
        let _ = window.emit("izci:desktop-tray-open", ());
        pause();
        snapshot(&window, "reopen");
        pause();
        let _ = window.eval(
            r#"(() => {
            localStorage.setItem('izci.playback-settings', JSON.stringify({enableRaf: false}));
            window.dispatchEvent(new StorageEvent('storage', {key: 'izci.playback-settings'}));
        })()"#,
        );
        pause();
        snapshot(&window, "raf-disabled");
        pause();
        let _ = window.eval(
            r#"(() => {
            localStorage.setItem('izci.playback-settings', JSON.stringify({enableRaf: true}));
            window.dispatchEvent(new StorageEvent('storage', {key: 'izci.playback-settings'}));
        })()"#,
        );
        pause();
        snapshot(&window, "raf-restored");
    });
}

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = format!("app.izci.traysmoke{}", std::process::id());
    let profile = std::env::temp_dir().join(format!("izci-tray-smoke-{}", std::process::id()));
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(20));
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
                    localStorage.setItem('izci.playback-settings', JSON.stringify({enableRaf: true}));
                    localStorage.setItem('izci.raf-presets', JSON.stringify({presets:
                        Array.from({length: 6}, (_, index) => ({id: `preset-${index}`, name: `Preset ${index}`, settings: {effects: []}})),
                        selectedPresetId: 'preset-0'
                    }));
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
