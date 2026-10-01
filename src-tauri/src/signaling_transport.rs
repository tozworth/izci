//! Plain HTTP signaling for desktop parties. HTTPS continues through Chromium.
//! A narrow IPC transport avoids weakening WebView mixed-content protections.
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{ipc::Channel, Manager, State, WebviewWindow};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};

const LIMIT: usize = 64 * 1024;
#[derive(Default)]
pub struct Transport {
    requests: Mutex<HashMap<String, watch::Sender<bool>>>,
    sockets: Mutex<HashMap<String, mpsc::Sender<Option<String>>>>,
}

pub fn stop(app: &tauri::AppHandle) {
    let state = app.state::<Transport>();
    if let Ok(mut requests) = state.requests.lock() {
        for (_, cancel) in requests.drain() {
            let _ = cancel.send(true);
        }
    }
    if let Ok(mut sockets) = state.sockets.lock() {
        for (_, socket) in sockets.drain() {
            let _ = socket.try_send(None);
        }
    };
}

fn target(raw: &str, socket: bool) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(raw).map_err(|_| "Invalid signaling address")?;
    let path = url.path();
    let Some((_, route)) = path.split_once("/v1/") else {
        return Err("Invalid signaling route".into());
    };
    if raw.len() > 1024
        || url.scheme() != if socket { "ws" } else { "http" }
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || (socket && route != "socket")
        || (!socket
            && !(matches!(
                route,
                "info"
                    | "ice"
                    | "join"
                    | "socket-tickets"
                    | "host/session"
                    | "host/sessions"
                    | "rooms"
                    | "dedicated-room"
            ) || route.starts_with("rooms/")))
    {
        return Err("Invalid signaling address".into());
    }
    Ok(url)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    id: String,
    url: String,
    method: String,
    body: Option<String>,
    bearer: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    status: u16,
    body: String,
    retry_after: Option<String>,
}

#[tauri::command]
pub async fn signaling_http(
    window: WebviewWindow,
    state: State<'_, Transport>,
    request: Request,
) -> Result<Response, String> {
    crate::signaling::require_local(&window, false)?;
    let url = target(&request.url, false)?;
    if request.id.len() > 64
        || request.body.as_ref().is_some_and(|body| body.len() > LIMIT)
        || request
            .bearer
            .as_ref()
            .is_some_and(|token| token.len() > 256)
        || !matches!(request.method.as_str(), "GET" | "POST" | "DELETE")
    {
        return Err("Invalid signaling request".into());
    }
    let (cancel, mut cancelled) = watch::channel(false);
    {
        let mut requests = state.requests.lock().map_err(|_| "Transport unavailable")?;
        if requests.len() >= 64 || requests.contains_key(&request.id) {
            return Err("Too many signaling requests".into());
        }
        requests.insert(request.id.clone(), cancel);
    }
    let operation = async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| "Signaling transport unavailable")?;
        let mut call = client.request(request.method.parse().unwrap(), url);
        if let Some(bearer) = request.bearer {
            call = call.bearer_auth(bearer);
        }
        if let Some(body) = request.body {
            call = call.header("Content-Type", "application/json").body(body);
        }
        let mut response = call
            .send()
            .await
            .map_err(|_| "Could not reach signaling server")?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Could not read signaling response")?
        {
            if body.len() + chunk.len() > LIMIT {
                return Err("Signaling response too large");
            }
            body.extend_from_slice(&chunk);
        }
        Ok(Response {
            status,
            body: String::from_utf8(body).map_err(|_| "Invalid signaling response")?,
            retry_after,
        })
    };
    let result = tokio::select! { result = operation => result.map_err(String::from), _ = cancelled.changed() => Err("Signaling request cancelled".into()) };
    if let Ok(mut requests) = state.requests.lock() {
        requests.remove(&request.id);
    }
    result
}

#[tauri::command]
pub fn cancel_signaling_http(
    window: WebviewWindow,
    state: State<'_, Transport>,
    id: String,
) -> Result<(), String> {
    crate::signaling::require_local(&window, false)?;
    if let Some(cancel) = state
        .requests
        .lock()
        .map_err(|_| "Transport unavailable")?
        .get(&id)
    {
        let _ = cancel.send(true);
    }
    Ok(())
}

#[tauri::command]
pub fn open_signaling_socket(
    window: WebviewWindow,
    state: State<'_, Transport>,
    id: String,
    url: String,
    events: Channel<serde_json::Value>,
) -> Result<(), String> {
    crate::signaling::require_local(&window, false)?;
    let url = target(&url, true)?;
    let (tx, mut rx) = mpsc::channel::<Option<String>>(64);
    {
        let mut sockets = state.sockets.lock().map_err(|_| "Transport unavailable")?;
        if id.len() > 64 || sockets.len() >= 16 || sockets.contains_key(&id) {
            return Err("Too many signaling sockets".into());
        }
        sockets.insert(id.clone(), tx);
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let config = WebSocketConfig::default()
            .max_message_size(Some(LIMIT))
            .max_frame_size(Some(LIMIT));
        let connect = tokio::time::timeout(
            Duration::from_secs(15),
            tokio_tungstenite::connect_async_with_config(url.as_str(), Some(config), false),
        );
        let connected = tokio::select! { result = connect => result.ok().and_then(Result::ok), _ = rx.recv() => None };
        if let Some((mut socket, _)) = connected {
            if events.send(serde_json::json!({"type":"open"})).is_ok() {
                loop {
                    tokio::select! {
                        command = rx.recv() => match command {
                            Some(Some(text)) => if socket.send(Message::Text(text.into())).await.is_err() { break; },
                            _ => { let _ = socket.close(None).await; break; }
                        },
                        message = socket.next() => match message {
                            Some(Ok(Message::Text(text))) => if events.send(serde_json::json!({"type":"message", "data":text.as_str()})).is_err() { break; },
                            Some(Ok(Message::Ping(data))) => if socket.send(Message::Pong(data)).await.is_err() { break; },
                            Some(Ok(Message::Pong(_))) => {},
                            _ => break,
                        }
                    }
                }
            }
        } else {
            let _ = events.send(serde_json::json!({"type":"error"}));
        }
        let _ = events.send(serde_json::json!({"type":"close", "code":1000, "reason":""}));
        if let Ok(mut sockets) = app.state::<Transport>().sockets.lock() {
            sockets.remove(&id);
        };
    });
    Ok(())
}

#[tauri::command]
pub fn send_signaling_socket(
    window: WebviewWindow,
    state: State<'_, Transport>,
    id: String,
    text: Option<String>,
) -> Result<(), String> {
    crate::signaling::require_local(&window, false)?;
    if text.as_ref().is_some_and(|text| text.len() > LIMIT) {
        return Err("Signaling message too large".into());
    }
    let sockets = state.sockets.lock().map_err(|_| "Transport unavailable")?;
    let socket = sockets.get(&id).ok_or("Signaling socket closed")?;
    socket
        .try_send(text)
        .map_err(|_| "Signaling socket queue full".into())
}

#[cfg(test)]
mod tests {
    use super::target;
    #[test]
    fn native_transport_only_accepts_plain_signaling_routes() {
        assert!(target("http://192.168.1.8:8787/v1/info", false).is_ok());
        assert!(target("ws://192.168.1.8:8787/prefix/v1/socket", true).is_ok());
        for url in [
            "https://host/v1/info",
            "http://host/file",
            "http://user:secret@host/v1/info",
            "http://host/v1/info?ticket=secret",
            "http://host/v1/info#secret",
        ] {
            assert!(target(url, false).is_err());
        }
        assert!(target("ws://host/v1/rooms", true).is_err());
    }
}
