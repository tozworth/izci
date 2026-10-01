use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, WebviewWindow};

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
enum Request {
    Eval { expression: String },
    Stop {},
}

pub fn write_json(path: &Path, value: &Value) -> io::Result<()> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(value)?)?;
    fs::rename(temporary, path)
}

fn request_id(path: &Path) -> Option<&str> {
    let name = path.file_stem()?.to_str()?;
    (path.extension()?.to_str()? == "json"
        && name.len() == 32
        && name.bytes().all(|byte| byte.is_ascii_hexdigit()))
    .then_some(name)
}

pub fn start(window: WebviewWindow, directory: PathBuf) {
    std::thread::spawn(move || loop {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let _ = write_json(
            &directory.join("heartbeat.json"),
            &json!({"pid": std::process::id(), "at": now}),
        );
        if let Ok(entries) = fs::read_dir(directory.join("requests")) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(id) = request_id(&path).map(str::to_owned) else {
                    continue;
                };
                let response = directory.join("responses").join(format!("{id}.json"));
                let request = fs::metadata(&path).and_then(|meta| {
                    if meta.len() > 4 * 1024 * 1024 {
                        return Err(io::Error::other("Diagnostic request is too large"));
                    }
                    serde_json::from_slice::<Request>(&fs::read(&path)?).map_err(io::Error::other)
                });
                let _ = fs::remove_file(path);
                match request {
                    Ok(Request::Stop {}) => {
                        let _ = write_json(&response, &json!({"ok": true, "stopped": true}));
                        window.app_handle().exit(0);
                        return;
                    }
                    Ok(Request::Eval { expression }) => {
                        let window = window.clone();
                        tauri::async_runtime::spawn(async move {
                            let result = crate::desktop_files::devtools(&window, "Runtime.evaluate", json!({
                                "expression": expression, "awaitPromise": true, "returnByValue": true
                            })).await;
                            let value = match result {
                                Ok(result) => {
                                    json!({"ok": result.get("exceptionDetails").is_none(), "evaluation": result})
                                }
                                Err(error) => json!({"ok": false, "error": error}),
                            };
                            let _ = write_json(&response, &value);
                        });
                    }
                    Err(error) => {
                        let _ = write_json(
                            &response,
                            &json!({"ok": false, "error": error.to_string()}),
                        );
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_fixed_local_request_names_are_accepted() {
        assert!(request_id(Path::new("0123456789abcdef0123456789abcdef.json")).is_some());
        assert!(request_id(Path::new("stop.json")).is_none());
        assert!(request_id(Path::new("0123456789abcdef0123456789abcdef.tmp")).is_none());
    }
    #[test]
    fn rejects_unknown_actions_and_fields() {
        assert!(serde_json::from_str::<Request>(r#"{"action":"stop"}"#).is_ok());
        assert!(serde_json::from_str::<Request>(r#"{"action":"eval","expression":"1+1"}"#).is_ok());
        assert!(serde_json::from_str::<Request>(r#"{"action":"stop","path":"outside"}"#).is_err());
        assert!(serde_json::from_str::<Request>(r#"{"action":"delete"}"#).is_err());
    }
}
