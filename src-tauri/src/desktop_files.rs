use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::core::HSTRING;

pub struct LaunchFiles {
    pending: Mutex<Vec<String>>,
    focus: AtomicBool,
}

impl Default for LaunchFiles {
    fn default() -> Self {
        Self::new(Vec::new())
    }
}

impl LaunchFiles {
    pub fn new(paths: Vec<String>) -> Self {
        Self {
            pending: Mutex::new(paths),
            focus: AtomicBool::new(true),
        }
    }

    fn should_present(&self, has_files: bool) -> bool {
        !has_files || self.focus.load(Ordering::Relaxed)
    }
}

#[tauri::command]
pub fn configure_desktop_file_launch(
    window: WebviewWindow,
    state: tauri::State<'_, LaunchFiles>,
    focus: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the playback owner configures file launches".into());
    }
    state.focus.store(focus, Ordering::Relaxed);
    Ok(())
}

fn canonical_media_path(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if !crate::associations::formats().contains_key(&extension) {
        return None;
    }
    let path = path.canonicalize().ok()?;
    if !path.is_file() {
        return None;
    }
    let value = path.to_str()?;
    Some(if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        value.strip_prefix("\\\\?\\").unwrap_or(value).to_string()
    })
}

pub fn launch_paths(args: impl Iterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.skip(1)
        .filter(|argument| !argument.starts_with('-'))
        .filter_map(|argument| {
            let path = PathBuf::from(argument);
            canonical_media_path(&if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            })
        })
        .collect()
}

pub fn enqueue(app: &AppHandle, args: Vec<String>, cwd: &str) -> bool {
    let paths = launch_paths(args.into_iter(), Path::new(cwd));
    let state = app.state::<LaunchFiles>();
    let present = state.should_present(!paths.is_empty());
    if let Ok(mut pending) = state.pending.lock() {
        pending.extend(paths);
    }
    let _ = app.emit_to("main", "izci:desktop-files-available", ());
    present
}

#[tauri::command]
pub fn take_desktop_launch_paths(
    window: WebviewWindow,
    state: tauri::State<'_, LaunchFiles>,
) -> Result<Vec<String>, String> {
    if window.label() != "main" {
        return Err("Only the playback owner imports launch files".into());
    }
    Ok(std::mem::take(
        &mut *state.pending.lock().map_err(|error| error.to_string())?,
    ))
}

pub(crate) async fn devtools(
    window: &WebviewWindow,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let method = HSTRING::from(method);
    let parameters = HSTRING::from(params.to_string());
    window
        .with_webview(move |webview| {
            let completion_sender = sender.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |error, result| {
                    let result = error
                        .map_err(|error| error.to_string())
                        .and_then(|_| {
                            serde_json::from_str::<Value>(&result)
                                .map_err(|error| error.to_string())
                        })
                        .and_then(|value| {
                            if value.get("error").is_some() {
                                Err("WebView2 could not select the file".into())
                            } else {
                                Ok(value)
                            }
                        });
                    let _ = completion_sender.try_send(result);
                    Ok(())
                },
            ));
            let result = unsafe {
                webview.controller().CoreWebView2().and_then(|core| {
                    core.CallDevToolsProtocolMethod(&method, &parameters, &handler)
                })
            };
            if let Err(error) = result {
                let _ = sender.try_send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("WebView2 file selection was interrupted")?
}

#[tauri::command]
pub async fn materialize_desktop_files(
    window: WebviewWindow,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    crate::native_filesystem::require_app_window(&window)?;
    if paths.len() > 1024 {
        return Err("Too many launch files".into());
    }
    let paths: Vec<String> = paths
        .iter()
        .map(|path| crate::native_filesystem::canonical_path(Path::new(path), false))
        .collect::<Result<_, _>>()?;
    if paths.is_empty() {
        return Ok(paths);
    }
    let element = devtools(&window, "Runtime.evaluate", json!({
        "expression": "document.getElementById('izci-desktop-file-input')", "objectGroup": "izci-file-selection"
    })).await?;
    let object_id = element
        .pointer("/result/objectId")
        .and_then(Value::as_str)
        .ok_or("Desktop file input is unavailable")?;
    let result = devtools(
        &window,
        "DOM.setFileInputFiles",
        json!({ "files": paths, "objectId": object_id }),
    )
    .await;
    let _ = devtools(
        &window,
        "Runtime.releaseObjectGroup",
        json!({ "objectGroup": "izci-file-selection" }),
    )
    .await;
    result?;
    Ok(paths)
}

#[cfg(test)]
mod tests {
    #[test]
    fn background_file_launches_leave_plain_launches_visible() {
        let state = super::LaunchFiles::default();
        assert!(state.should_present(true));
        assert!(state.should_present(false));
        state.focus.store(false, super::Ordering::Relaxed);
        assert!(!state.should_present(true));
        assert!(state.should_present(false));
        state.focus.store(true, super::Ordering::Relaxed);
        assert!(state.should_present(true));
    }

    #[test]
    fn launch_filters_flags_non_media_and_directories_and_preserves_unicode() {
        let folder = std::env::temp_dir().join(format!("izci-file-launch-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let media = folder.join("şarkı with spaces.FLAC");
        std::fs::write(&media, []).unwrap();
        let paths = super::launch_paths(
            vec![
                "izci.exe".into(),
                "--open".into(),
                media.to_str().unwrap().into(),
                "secret.txt".into(),
                folder.to_str().unwrap().into(),
            ]
            .into_iter(),
            &folder,
        );
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("şarkı with spaces.FLAC"));
        std::fs::remove_file(media).unwrap();
        std::fs::remove_dir(folder).unwrap();
    }
}
