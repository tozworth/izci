//! Embedded signaling executable; extracted and started only by the playback
//! owner. Its private pipe is the sole bootstrap/lifetime authority.
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Read, Write},
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows::Win32::{
    Foundation::HANDLE,
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    port: u16,
    public_url: String,
    upnp: bool,
    ice_urls: Vec<String>,
    allowed_origins: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ready {
    endpoint: String,
    public_endpoint: String,
    lan_endpoints: Vec<String>,
    session_token: String,
    mapping: String,
}

struct Runtime {
    child: Child,
    input: Option<ChildStdin>,
    _job: OwnedHandle,
    _extraction: Extraction,
    ready: Ready,
}

impl Drop for Runtime {
    fn drop(&mut self) {
        self.input.take(); // EOF requests graceful server/mapping shutdown.
        let deadline = Instant::now() + Duration::from_secs(6);
        while Instant::now() < deadline {
            if self.child.try_wait().ok().flatten().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Extraction(PathBuf);
impl Drop for Extraction {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
pub struct Signaling(Mutex<Option<Runtime>>);

pub(crate) fn require_local(window: &WebviewWindow, owner: bool) -> Result<(), String> {
    if owner && window.label() != "main" {
        return Err("Only the playback owner can control built-in signaling".into());
    }
    if !window
        .url()
        .is_ok_and(|url| crate::windows::is_app_url(&url))
    {
        return Err("Signaling commands require the packaged app".into());
    }
    Ok(())
}

fn start(app: &AppHandle, options: Options) -> Result<Ready, String> {
    let state = app.state::<Signaling>();
    let mut runtime = state.0.lock().map_err(|_| "Signaling state unavailable")?;
    if runtime.is_some() {
        return Err("Stop the current party before starting another".into());
    }
    let owned = spawn_owned(options)?;
    let ready = owned.ready.clone();
    *runtime = Some(owned);
    Ok(ready)
}

fn spawn_owned(options: Options) -> Result<Runtime, String> {
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Could not initialize signaling")?;
    let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let directory = std::env::temp_dir().join(format!("izci-signal-{suffix}"));
    std::fs::create_dir(&directory).map_err(|_| "Could not prepare built-in signaling")?;
    let directory = Extraction(directory);
    let path = directory.0.join("signal.exe");
    if std::fs::write(
        &path,
        include_bytes!(concat!(env!("OUT_DIR"), "/izci-signal.exe")),
    )
    .is_err()
    {
        return Err("Could not unpack built-in signaling".into());
    }
    // A Windows job closes the child even after an app crash/forced termination.
    let job = unsafe {
        let handle =
            CreateJobObjectW(None, None).map_err(|_| "Could not bind signaling lifetime")?;
        let job = OwnedHandle::from_raw_handle(handle.0);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&limits).cast(),
            std::mem::size_of_val(&limits) as u32,
        )
        .map_err(|_| "Could not bind signaling lifetime")?;
        job
    };
    let mut child = Command::new(path)
        .creation_flags(0x08000000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Could not start built-in signaling")?;
    if unsafe {
        AssignProcessToJobObject(HANDLE(job.as_raw_handle()), HANDLE(child.as_raw_handle()))
    }
    .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Could not bind signaling to izci.exe".into());
    }
    let output = child.stdout.take().unwrap();
    let input = child.stdin.take().unwrap();
    let mut owned = Runtime {
        child,
        input: Some(input),
        _job: job,
        _extraction: directory,
        ready: Ready {
            endpoint: String::new(),
            public_endpoint: String::new(),
            lan_endpoints: vec![],
            session_token: String::new(),
            mapping: String::new(),
        },
    };
    let line = serde_json::to_vec(&options).map_err(|_| "Invalid signaling configuration")?;
    let pipe = owned.input.as_mut().unwrap();
    pipe.write_all(&line)
        .and_then(|_| pipe.write_all(b"\n"))
        .map_err(|_| "Could not configure built-in signaling")?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(output)
            .take(8192)
            .read_line(&mut line)
            .ok()
            .and_then(|_| serde_json::from_str::<Ready>(&line).ok());
        let _ = tx.send(result);
    });
    owned.ready = rx
        .recv_timeout(Duration::from_secs(15))
        .ok()
        .flatten()
        .ok_or("Built-in signaling could not start. Check the port and server settings.")?;
    Ok(owned)
}

#[cfg(test)]
mod tests {
    use super::{spawn_owned, Options};
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        time::Duration,
    };

    #[test]
    fn embedded_runtime_is_pipe_owned_and_releases_its_files_and_port() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let owned = spawn_owned(Options {
            port: address.port(),
            public_url: String::new(),
            upnp: false,
            ice_urls: vec![],
            allowed_origins: vec![],
        })
        .unwrap();
        let directory = owned._extraction.0.clone();
        assert!(directory.join("signal.exe").is_file());
        assert!(!owned.ready.session_token.is_empty());
        let mut socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        socket.write_all(b"POST /v1/host/sessions HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();
        let mut response = String::new();
        socket.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 403"));
        drop(socket);
        drop(owned);
        assert!(!directory.exists());
        assert!(TcpStream::connect(address).is_err());
    }
}

pub fn stop(app: &AppHandle, endpoint: Option<&str>) {
    if let Ok(mut runtime) = app.state::<Signaling>().0.lock() {
        if endpoint.is_none()
            || runtime
                .as_ref()
                .is_some_and(|owned| Some(owned.ready.endpoint.as_str()) == endpoint)
        {
            runtime.take();
        }
    }
}

#[tauri::command]
pub async fn start_builtin_signaling(
    app: AppHandle,
    window: WebviewWindow,
    options: Options,
) -> Result<Ready, String> {
    require_local(&window, true)?;
    tauri::async_runtime::spawn_blocking(move || start(&app, options))
        .await
        .map_err(|_| "Could not start signaling")?
}

#[tauri::command]
pub async fn stop_builtin_signaling(
    app: AppHandle,
    window: WebviewWindow,
    endpoint: Option<String>,
) -> Result<(), String> {
    require_local(&window, true)?;
    tauri::async_runtime::spawn_blocking(move || stop(&app, endpoint.as_deref()))
        .await
        .map_err(|_| "Could not stop signaling".to_string())
}
