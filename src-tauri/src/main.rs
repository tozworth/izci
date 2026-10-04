#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
compile_error!("The izci desktop MVP currently supports Windows only.");

mod associations;
mod autostart;
mod desktop_files;
mod file_icons;
mod fonts;
mod native_file_picker;
mod native_filesystem;
mod native_media_access;
mod playback_restoration;
mod player_windows;
#[cfg(feature = "builtin-signaling")]
mod signaling;
#[cfg(feature = "builtin-signaling")]
mod signaling_transport;
mod tray;
mod tray_bubble;
mod tray_scroll;
mod window_lifecycle;
mod window_presentation;
mod window_resources;
mod window_state;
mod windows;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

fn require_player_window(window: &WebviewWindow) -> Result<(), String> {
    match window.label() {
        "main" | "mini-player" => Ok(()),
        _ => Err("This command is only available to player windows".into()),
    }
}

#[tauri::command]
fn open_mini_player(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the playback owner can open the miniplayer".into());
    }
    player_windows::open_mini(&app)
}

fn close_mini(app: &AppHandle) -> Result<(), String> {
    player_windows::restore_main(app)
}

#[tauri::command]
fn close_mini_player(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_player_window(&window)?;
    close_mini(&app)
}

#[tauri::command]
fn dismiss_mini_player(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "mini-player" {
        return Err("Only the miniplayer can dismiss itself".into());
    }
    player_windows::dismiss_mini(&app)
}

#[tauri::command]
fn restore_main_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_player_window(&window)?;
    windows::restore_main(&app)
}

#[tauri::command]
fn pin_mini_player(window: WebviewWindow, pinned: bool) -> Result<(), String> {
    if window.label() != "mini-player" {
        return Err("Only the miniplayer can change its pin state".into());
    }
    window
        .set_always_on_top(pinned)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn exit_desktop(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can exit the player".into());
    }
    window_lifecycle::close_player(window.app_handle());
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let boot_launch = autostart::is_boot_launch(args.clone());
            // Windows startup must not activate an already running player.
            if boot_launch && app.get_webview_window("main").is_some() {
                return;
            }
            let present = desktop_files::enqueue(app, args, &cwd);
            // A surviving workbench may keep the process alive after the player
            // closes. Recreate the playback owner for that launch as usual.
            if !present && app.get_webview_window("main").is_some() {
                return;
            }
            if app.get_webview_window("main").is_none() {
                if let Ok(mut state) = app
                    .state::<std::sync::Mutex<window_presentation::WindowPresentation>>()
                    .lock()
                {
                    state.begin_launch(boot_launch);
                }
            }
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = windows::create_player_windows(&app);
                if !boot_launch {
                    let _ = window_presentation::request_main(&app);
                }
            });
        }))
        .manage(window_lifecycle::WindowLifecycle::default())
        .manage(window_state::WindowState::default())
        .manage(player_windows::PlayerWindowMode::default())
        .manage(desktop_files::LaunchFiles::new(
            desktop_files::launch_paths(
                std::env::args(),
                &std::env::current_dir().unwrap_or_default(),
            ),
        ))
        .manage(std::sync::Mutex::new(tray::TrayMenuState::default()))
        .manage(std::sync::Mutex::new(
            window_presentation::WindowPresentation::new(autostart::is_boot_launch(
                std::env::args(),
            )),
        ))
        .invoke_handler(tauri::generate_handler![
            open_mini_player,
            close_mini_player,
            dismiss_mini_player,
            restore_main_window,
            pin_mini_player,
            exit_desktop,
            player_windows::configure_desktop_close,
            #[cfg(feature = "builtin-signaling")]
            signaling::start_builtin_signaling,
            #[cfg(feature = "builtin-signaling")]
            signaling::stop_builtin_signaling,
            #[cfg(feature = "builtin-signaling")]
            signaling_transport::signaling_http,
            #[cfg(feature = "builtin-signaling")]
            signaling_transport::cancel_signaling_http,
            #[cfg(feature = "builtin-signaling")]
            signaling_transport::open_signaling_socket,
            #[cfg(feature = "builtin-signaling")]
            signaling_transport::send_signaling_socket,
            playback_restoration::prepare_desktop_playback_restoration,
            window_presentation::desktop_window_ready,
            window_presentation::present_desktop_popup,
            fonts::local_font_families,
            associations::configure_desktop_associations,
            autostart::configure_desktop_autostart,
            associations::open_desktop_default_apps,
            desktop_files::take_desktop_launch_paths,
            desktop_files::configure_desktop_file_launch,
            desktop_files::materialize_desktop_files,
            native_filesystem::pick_desktop_paths,
            native_filesystem::read_desktop_folder,
            native_filesystem::query_desktop_folder_permission,
            native_media_access::query_desktop_media_write_permission,
            native_media_access::access_desktop_media_entry,
            native_media_access::begin_desktop_media_write,
            native_media_access::update_desktop_media_write,
            native_media_access::finish_desktop_media_write,
            native_media_access::move_desktop_media_file,
            native_media_access::remove_desktop_media_entry,
            tray::configure_desktop_visibility,
            tray::desktop_tray_menu_ready,
            tray::show_desktop_tray_menu,
            tray::hide_desktop_tray_menu,
            tray_bubble::show_desktop_track_bubble,
            tray_bubble::hide_desktop_track_bubble
        ])
        .setup(|app| {
            #[cfg(feature = "builtin-signaling")]
            app.manage(signaling::Signaling::default());
            #[cfg(feature = "builtin-signaling")]
            app.manage(signaling_transport::Transport::default());
            windows::create_player_windows(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                native_media_access::abort_owner(window.label());
            }
            match (window.label(), event) {
                ("main" | "mini-player", WindowEvent::Focused(true)) => {
                    tray_bubble::dismiss(window.app_handle());
                }
                ("main" | "mini-player", WindowEvent::Moved(_) | WindowEvent::Resized(_)) => {
                    window_state::capture(window);
                }
                ("main", WindowEvent::CloseRequested { api, .. }) => {
                    api.prevent_close();
                    if let Err(error) = player_windows::close_main(window.app_handle()) {
                        eprintln!("Could not close the main window: {error}");
                    }
                }
                ("mini-player", WindowEvent::CloseRequested { api, .. }) => {
                    if window.app_handle().get_webview_window("main").is_some() {
                        api.prevent_close();
                        let _ = player_windows::dismiss_mini(window.app_handle());
                    }
                }
                ("main", WindowEvent::Destroyed) => {
                    tray::remove(window.app_handle());
                    if let Ok(mut state) = window
                        .app_handle()
                        .state::<std::sync::Mutex<window_presentation::WindowPresentation>>()
                        .lock()
                    {
                        state.forget("main");
                    }
                    window_lifecycle::destroyed(window.app_handle(), "main");
                    window_lifecycle::close_player(window.app_handle());
                }
                ("tray-menu", WindowEvent::Focused(false)) => {
                    if let Some(webview) = window.app_handle().get_webview_window("tray-menu") {
                        let _ = window_resources::hide(&webview);
                    }
                    let _ = window.emit("izci:desktop-tray-dismiss", ());
                }
                ("tray-menu", WindowEvent::Destroyed) => {
                    if let Ok(mut state) = window
                        .app_handle()
                        .state::<std::sync::Mutex<tray::TrayMenuState>>()
                        .lock()
                    {
                        *state = tray::TrayMenuState::default();
                    }
                    window_lifecycle::destroyed(window.app_handle(), "tray-menu");
                }
                (_, WindowEvent::CloseRequested { api, .. }) => {
                    // Options is a reusable settings surface. Tools retain their
                    // normal close lifecycle so jobs and audio resources can clean up.
                    if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                        if windows::is_options_window(&webview) {
                            api.prevent_close();
                            let _ = window_resources::hide(&webview);
                        }
                    }
                }
                (_, WindowEvent::Destroyed) => {
                    if let Ok(mut presentation) = window
                        .app_handle()
                        .state::<std::sync::Mutex<window_presentation::WindowPresentation>>()
                        .lock()
                    {
                        presentation.forget(window.label());
                    }
                    window_lifecycle::destroyed(window.app_handle(), window.label());
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not start izci");
}
