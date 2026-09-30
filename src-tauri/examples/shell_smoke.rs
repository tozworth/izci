//! Hidden Windows check of tray commands over real IPC and native owner close.
//! Uses an isolated application identifier/profile; never registers file types.
#[allow(dead_code)]
#[path = "../src/fonts.rs"]
mod fonts;
#[allow(dead_code)]
#[path = "../src/player_windows.rs"]
mod player_windows;
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
#[path = "../src/window_resources.rs"]
mod window_resources;
// Presentation checks must never save smoke-window placement to the player's
// registry key. Persistence is covered by the real module's unit tests.
mod window_state {
    #[derive(Default)]
    pub struct WindowState;
    pub fn capture(_: &tauri::Window) {}
    pub fn restore(_: &tauri::Window) {}
    pub fn save(_: &tauri::Window) {}
}
#[allow(dead_code)]
#[path = "../src/windows.rs"]
mod windows;

use ::windows::core::{Interface, BOOL};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{utils::config::WindowConfig, Emitter, Manager, WindowEvent};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};

async fn check_resources(window: &tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    window
        .with_webview(move |webview| {
            let result = (|| unsafe {
                let controller = webview.controller();
                let mut actual = BOOL::default();
                controller
                    .IsVisible(&mut actual)
                    .map_err(|error| error.to_string())?;
                if actual.as_bool() != visible {
                    return Err(
                        "WebView2 controller visibility did not follow the native window".into(),
                    );
                }
                let core = controller
                    .CoreWebView2()
                    .map_err(|error| error.to_string())?;
                if let Ok(core) = core.cast::<ICoreWebView2_19>() {
                    let expected = if visible {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    };
                    let mut actual = COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL;
                    core.MemoryUsageTargetLevel(&mut actual)
                        .map_err(|error| error.to_string())?;
                    if actual != expected {
                        return Err("WebView2 memory target did not follow visibility".into());
                    }
                }
                Ok(())
            })();
            let _ = sender.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("WebView2 resource check did not complete")?
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
async fn smoke_utilities(app: tauri::AppHandle) -> Result<(), String> {
    let owner = app.get_webview_window("main").ok_or("Missing owner")?;
    window_resources::set_active(&owner, false);
    check_resources(&owner, true).await?;
    for label in ["mini-player", "tray-menu"] {
        let window = app.get_webview_window(label).ok_or("Missing utility")?;
        check_resources(&window, false).await?;
        if label == "tray-menu" {
            app.state::<Mutex<tray::TrayMenuState>>()
                .lock()
                .map_err(|error| error.to_string())?
                .position = Some(tauri::PhysicalPosition::new(500.0, 500.0));
            tray::show_desktop_tray_menu(app.clone(), window.clone(), 220.0, 200.0, app.state())?;
        } else {
            window_resources::show(&window)?;
        }
        check_resources(&window, true).await?;
        if label == "tray-menu" {
            tray::hide_desktop_tray_menu(window.clone())?;
        } else {
            window_resources::hide(&window)?;
        }
        check_resources(&window, false).await?;
        println!("Verified {label} controller visibility and low/normal memory targets.");
    }
    check_resources(&owner, true).await?;
    Ok(())
}

fn check_player_mode(app: &tauri::AppHandle, mini_mode: bool) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("Missing owner")?;
    let mini = app
        .get_webview_window("mini-player")
        .ok_or("Missing mini")?;
    if main.is_visible().map_err(|error| error.to_string())? == mini_mode
        || mini.is_visible().map_err(|error| error.to_string())? != mini_mode
        || player_windows::mini_active(app) != mini_mode
    {
        return Err("Main and mini player did not switch exclusively".into());
    }
    Ok(())
}

#[tauri::command]
async fn smoke_player_modes(app: tauri::AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("Missing owner")?;
    let mini = app
        .get_webview_window("mini-player")
        .ok_or("Missing mini")?;
    for _ in 0..3 {
        windows::restore_main(&app)?;
        check_player_mode(&app, false)?;
        player_windows::open_mini(&app)?;
        check_player_mode(&app, true)?;
        check_resources(&main, true).await?;
        check_resources(&mini, true).await?;
        player_windows::dismiss_mini(&app)?;
        if main.is_visible().map_err(|error| error.to_string())?
            || mini.is_visible().map_err(|error| error.to_string())?
            || !player_windows::mini_active(&app)
        {
            return Err("Dismissing mini restored main or ended mini mode".into());
        }
        check_resources(&main, true).await?;
        check_resources(&mini, false).await?;
        tray::activate_player(&app, false)?;
        check_player_mode(&app, true)?;
        check_resources(&mini, true).await?;
        mini.minimize().map_err(|error| error.to_string())?;
        tray::activate_player(&app, false)?;
        check_player_mode(&app, true)?;
        if mini.is_minimized().map_err(|error| error.to_string())? {
            return Err("Single tray click did not restore the mini player".into());
        }
        tray::activate_player(&app, true)?;
        check_player_mode(&app, false)?;
        // Expand returns to main; close must only dismiss mini.
        player_windows::open_mini(&app)?;
        windows::restore_main(&app)?;
        check_player_mode(&app, false)?;
        check_resources(&mini, false).await?;
        player_windows::open_mini(&app)?;
        player_windows::dismiss_mini(&app)?;
        tray::activate_player(&app, true)?;
        check_player_mode(&app, false)?;
        player_windows::open_mini(&app)?;
        window_presentation::request_main(&app)?;
        check_player_mode(&app, false)?;
        main.minimize().map_err(|error| error.to_string())?;
        tray::activate_player(&app, false)?;
        if !main.is_minimized().map_err(|error| error.to_string())? {
            return Err("Single tray click changed main mode".into());
        }
        tray::activate_player(&app, true)?;
        check_player_mode(&app, false)?;
    }
    tray::configure_desktop_visibility(app.clone(), main.clone(), tray::DesktopShowIn::Taskbar)
        .await?;
    player_windows::open_mini(&app)?;
    player_windows::dismiss_mini(&app)?;
    check_player_mode(&app, true)?;
    if !mini.is_minimized().map_err(|error| error.to_string())? {
        return Err("Dismissing mini without a tray lost taskbar access".into());
    }
    windows::restore_main(&app)?;
    tray::configure_desktop_visibility(app.clone(), main.clone(), tray::DesktopShowIn::Both)
        .await?;
    main.hide().map_err(|error| error.to_string())?;
    println!(
        "Verified exclusive switching, mini-only dismissal, and single/double tray activation."
    );
    Ok(())
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
    check_resources(&popup, visible).await?;
    if visible {
        window_resources::hide(&popup)?;
        check_resources(&popup, false).await?;
        window_resources::show(&popup)?;
        check_resources(&popup, true).await?;
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
        await invoke('desktop_window_ready');
        // Saved tray settings and Options warmup arrive concurrently at launch.
        const trayStartup = invoke('configure_desktop_visibility', { showIn: 'both' });
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
        await invoke('smoke_utilities');
        await invoke('smoke_player_modes');
        for (const showIn of ['both', 'tray', 'taskbar', 'tray', 'both']) {
            await invoke('configure_desktop_visibility', { showIn });
            await invoke('smoke_check', { enabled: showIn !== 'taskbar' });
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
        .manage(player_windows::PlayerWindowMode::default())
        .manage(Mutex::new(tray::TrayMenuState::default()))
        .manage(Mutex::new(
            window_presentation::WindowPresentation::default(),
        ))
        .invoke_handler(tauri::generate_handler![
            tray::configure_desktop_visibility,
            tray::desktop_tray_menu_ready,
            window_presentation::desktop_window_ready,
            window_presentation::present_desktop_popup,
            fonts::local_font_families,
            smoke_check,
            smoke_popup,
            smoke_utilities,
            smoke_player_modes,
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
                        window_resources::set_active(&window, window.is_visible().unwrap_or(false));
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
