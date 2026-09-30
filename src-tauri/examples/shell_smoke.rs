//! Hidden Windows check of tray commands over real IPC and native owner close.
//! Uses an isolated application identifier/profile; never registers file types.
#[allow(dead_code)]
#[path = "../src/fonts.rs"]
mod fonts;
#[allow(dead_code)]
#[path = "../src/tray.rs"]
mod tray;
#[allow(dead_code)]
#[path = "../src/window_lifecycle.rs"]
mod window_lifecycle;
#[allow(dead_code)]
#[path = "../src/window_presentation.rs"]
mod window_presentation;
#[allow(dead_code)]
#[path = "../src/window_state.rs"]
mod window_state;
#[allow(dead_code)]
#[path = "../src/windows.rs"]
mod windows;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{utils::config::WindowConfig, Emitter, Manager, WindowEvent};

fn close_mini(app: &tauri::AppHandle) -> Result<(), String> {
    windows::restore_main(app)
}

#[tauri::command]
fn smoke_check(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if app.tray_by_id("izci").is_some() != enabled {
        return Err("Tray icon lifetime did not follow the preference".into());
    }
    if enabled && app.get_webview_window("tray-menu").is_none() {
        return Err("Tray menu window was not created".into());
    }
    println!("Verified native tray enabled={enabled} through WebView2 IPC.");
    Ok(())
}

#[tauri::command]
fn smoke_error(error: String) {
    eprintln!("Shell smoke failed: {error}");
    std::process::exit(1);
}

#[tauri::command]
async fn smoke_popup(app: tauri::AppHandle, visible: bool, destroy: bool) -> Result<(), String> {
    let popup = app
        .webview_windows()
        .into_values()
        .find(|window| {
            window
                .label()
                .strip_prefix("popup-")
                .is_some_and(|id| id.parse::<u64>().is_ok())
        })
        .ok_or("Options popup was not created")?;
    if popup.url().map_err(|error| error.to_string())?.path() != "/options.html"
        || popup.is_visible().map_err(|error| error.to_string())? != visible
        || !windows::is_options_window(&popup)
    {
        return Err("Options navigation, visibility or lifecycle role is incorrect".into());
    }
    if destroy {
        popup.destroy().map_err(|error| error.to_string())?;
    }
    println!("Verified opener-linked Options popup visible={visible}.");
    Ok(())
}

const DRIVER: &str = r#"(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    try {
        // Saved tray settings and Options warmup arrive concurrently at launch.
        const trayStartup = invoke('configure_desktop_tray', { enabled: true });
        // Exercise real window.open and the packaged Options entrypoint, both
        // on a cold load and subsequent cached loads. The isolated profile and
        // placeholder owner never run playback or file associations.
        for (let index = 0; index < 3; index++) {
            let popup;
            const ready = new Promise(resolve => {
                const listener = event => {
                    if (event.origin === location.origin && event.source === popup
                        && event.data?.type === 'izci:popup-ready') {
                        window.removeEventListener('message', listener);
                        resolve();
                    }
                };
                window.addEventListener('message', listener);
            });
            popup = window.open('/options.html?desktop-prewarm=', `smoke-options-${index}`);
            if (!popup) throw new Error('Options popup was blocked');
            await ready;
            await trayStartup;
            await invoke('smoke_popup', { visible: false, destroy: false });
            await invoke('present_desktop_popup', { path: '/options.html' });
            await invoke('smoke_popup', { visible: true, destroy: true });
        }
        for (const enabled of [true, false, true]) {
            await invoke('configure_desktop_tray', { enabled });
            await invoke('smoke_check', { enabled });
        }
        await invoke('plugin:window|close', { label: 'main' });
    } catch (error) { await invoke('smoke_error', { error: String(error) }); }
})()"#;

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = format!("app.izci.shellsmoke{}", std::process::id());
    let workbench = std::env::args().any(|arg| arg == "--workbench");
    let closed = Arc::new(AtomicBool::new(false));
    let result = closed.clone();
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(30));
        eprintln!("Shell smoke timed out; native event loop or IPC is stuck.");
        std::process::exit(2);
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .manage(window_lifecycle::WindowLifecycle::default())
        .manage(window_state::WindowState::default())
        .manage(Mutex::new(tray::TrayMenuState::default()))
        .manage(Mutex::new(
            window_presentation::WindowPresentation::default(),
        ))
        .invoke_handler(tauri::generate_handler![
            tray::configure_desktop_tray,
            tray::desktop_tray_menu_ready,
            window_presentation::desktop_window_ready,
            window_presentation::present_desktop_popup,
            fonts::local_font_families,
            smoke_check,
            smoke_popup,
            smoke_error
        ])
        .setup(move |app| {
            // Placeholder owner and retained utilities cannot alter library,
            // playback, associations or the real application's profile.
            let mut entries = vec![
                ("mini-player", "mini-player.html"),
                ("retained-options", "options.html"),
                ("popup-workbench-options", "troubadour-options.html"),
                ("main", "index.html"),
            ];
            if workbench {
                entries.insert(0, ("popup-workbench", "troubadour.html"));
            }
            tray::create_menu(app.handle())?;
            for (label, path) in entries {
                let config = WindowConfig {
                    label: label.into(),
                    url: tauri::WebviewUrl::App(path.into()),
                    visible: false,
                    use_https_scheme: true,
                    ..Default::default()
                };
                windows::builder(app.handle(), &config)?
                    .on_web_resource_request(|_, response| {
                        response.headers_mut().remove("content-security-policy");
                        *response.body_mut() =
                            b"<!doctype html><html><body>Hidden native smoke check</body></html>"
                                .to_vec()
                                .into();
                    })
                    .on_page_load(move |window, payload| {
                        if label == "main"
                            && payload.event() == tauri::webview::PageLoadEvent::Finished
                        {
                            let _ = window.eval(DRIVER);
                        }
                    })
                    .build()?;
            }
            Ok(())
        })
        .on_window_event(move |window, event| match event {
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                window_lifecycle::close_player(window.app_handle());
            }
            WindowEvent::Destroyed => {
                if window.label() == "main" {
                    result.store(true, Ordering::SeqCst);
                    tray::remove(window.app_handle());
                    if workbench {
                        let app = window.app_handle().clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let workbench = app
                                .get_webview_window("popup-workbench")
                                .expect("Workbench survives owner close");
                            println!("Verified workbench survives owner close.");
                            let _ = workbench.destroy();
                        });
                    }
                }
                window_lifecycle::destroyed(window.app_handle(), window.label());
            }
            WindowEvent::Focused(false) if window.label() == "tray-menu" => {
                let _ = window.emit("izci:desktop-tray-dismiss", ());
            }
            _ => {}
        })
        .run(context)
        .expect("Native shell smoke");
    assert!(
        closed.load(Ordering::SeqCst),
        "Playback owner did not close"
    );
    println!("Verified: owner close exits the native process with hidden utility windows and a tray icon.");
}
