//! Inspect a copied WebView2 profile without mounting izci or changing its data.
#[allow(dead_code)]
#[path = "../src/associations.rs"]
mod associations;
#[allow(dead_code)]
#[path = "../src/desktop_files.rs"]
mod desktop_files;
#[path = "../src/file_icons.rs"]
mod file_icons;
#[allow(dead_code)]
#[path = "../src/native_file_picker.rs"]
mod native_file_picker;
#[allow(dead_code)]
#[path = "../src/native_filesystem.rs"]
mod native_filesystem;
#[path = "../src/playback_restoration.rs"]
mod playback_restoration;
mod windows {
    pub fn is_app_url(url: &tauri::Url) -> bool {
        url.scheme() == "https" && url.host_str() == Some("tauri.localhost")
    }
}

use ::windows::core::HSTRING;
use std::{borrow::Cow, path::PathBuf};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;

async fn evaluate(
    window: &tauri::WebviewWindow,
    expression: &str,
) -> Result<serde_json::Value, String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let parameters = HSTRING::from(serde_json::json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }).to_string());
    window
        .with_webview(move |webview| {
            let completion = sender.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |error, result| {
                    let result = error.map_err(|error| error.to_string()).and_then(|_| {
                        serde_json::from_str(&result).map_err(|error| error.to_string())
                    });
                    let _ = completion.try_send(result);
                    Ok(())
                },
            ));
            let result = unsafe {
                webview.controller().CoreWebView2().and_then(|core| {
                    core.CallDevToolsProtocolMethod(
                        &HSTRING::from("Runtime.evaluate"),
                        &parameters,
                        &handler,
                    )
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
        .ok_or("Profile evaluation interrupted")?
}

const INSPECT: &str = r#"(async () => {
    const checkpoint = JSON.parse(localStorage.getItem('izci.playback-restoration') || 'null');
    const settings = JSON.parse(localStorage.getItem('izci.playback-settings') || 'null');
    const databases = await indexedDB.databases();
    let state = null;
    if (databases.some(db => db.name === 'izci-queue')) {
        state = await new Promise((resolve, reject) => {
            const open = indexedDB.open('izci-queue');
            open.onerror = () => reject(open.error.message);
            open.onsuccess = () => {
                const db = open.result;
                const tx = db.transaction('queue', 'readonly');
                const get = tx.objectStore('queue').get('state');
                get.onsuccess = () => resolve(get.result);
                get.onerror = () => reject(get.error.message);
                tx.oncomplete = () => db.close();
            };
        });
    }
    const items = state?.items || [];
    const track = items.find(item => item.id === checkpoint?.trackId);
    window.debugTrack = track || items[0];
    window.__izciRestoreFileAccess = () => window.debugTrack.fileHandle.requestPermission({mode: 'read'});
    return { origin: location.origin, checkpoint, restoreMode: settings?.restoreMode,
        databases: databases.map(db => ({name: db.name, version: db.version})),
        queueCount: items.length, checkpointTrackFound: !!track,
        track: window.debugTrack ? { id: window.debugTrack.id, name: window.debugTrack.name,
            kind: window.debugTrack.kind, desktopFile: window.debugTrack.desktopFile,
            hasHandle: !!window.debugTrack.fileHandle } : null };
})()"#;

const ACCESS: &str = r#"(async () => {
    const handle = window.debugTrack?.fileHandle;
    if (!handle) return {hasHandle: false};
    let permission, read;
    try { permission = await handle.queryPermission({mode: 'read'}); } catch(e) { permission = e.name + ': ' + e.message; }
    try { const file = await handle.getFile(); read = {name: file.name, size: file.size}; } catch(e) { read = e.name + ': ' + e.message; }
    return {permission, read};
})()"#;

fn main() {
    let directory = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("Copied profile directory required"),
    );
    assert!(
        directory.join("EBWebView/Default").is_dir(),
        "Expected a copied WebView2 profile root"
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
    tauri::Builder::default().setup(move |app| {
        let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
            .use_https_scheme(true).visible(false).data_directory(directory)
            .on_web_resource_request(|_, response| {
                *response.body_mut() = Cow::Owned(b"<!doctype html><html><body>Profile diagnostics</body></html>".to_vec());
                *response.status_mut() = tauri::http::StatusCode::OK;
            })
            .on_page_load(|window, payload| {
                if payload.event() != tauri::webview::PageLoadEvent::Finished { return; }
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    let result = async {
                        let inspect = evaluate(&window, INSPECT).await?;
                        let before = evaluate(&window, ACCESS).await?;
                        let prepared = playback_restoration::prepare_desktop_playback_restoration(window.clone()).await;
                        let after = evaluate(&window, ACCESS).await?;
                        Ok::<_, String>(serde_json::json!({"stored": inspect, "before": before, "prepared": prepared, "after": after}))
                    }.await;
                    println!("{}", serde_json::to_string_pretty(&result).unwrap());
                    window.app_handle().exit(if result.is_ok() {0} else {1});
                });
            }).build()?;
        let _ = window;
        Ok(())
    }).run(tauri::generate_context!()).expect("Copied profile diagnostics");
}
