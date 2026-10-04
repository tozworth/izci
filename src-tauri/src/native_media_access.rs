//! Transient native editing targets. No handles or media buffers enter IndexedDB.
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::SystemTime,
};
use tauri::{Manager, WebviewWindow};
use windows::{
    core::HSTRING,
    Win32::Storage::FileSystem::{MoveFileW, ReplaceFileW, REPLACE_FILE_FLAGS},
};

use crate::native_filesystem::{canonical_path, require_app_window};

struct PendingWrite {
    owner: String,
    path: PathBuf,
    temporary: PathBuf,
    file: Option<File>,
    size: u64,
    modified: SystemTime,
}
impl Drop for PendingWrite {
    fn drop(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.temporary);
    }
}
static WRITES: OnceLock<Mutex<HashMap<String, PendingWrite>>> = OnceLock::new();
static NEXT_WRITE: AtomicU64 = AtomicU64::new(1);
fn writes() -> &'static Mutex<HashMap<String, PendingWrite>> {
    WRITES.get_or_init(Mutex::default)
}
fn io_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        format!("NotFoundError: {error}")
    } else {
        error.to_string()
    }
}
pub fn abort_owner(owner: &str) {
    if let Ok(mut entries) = writes().lock() {
        entries.retain(|_, entry| entry.owner != owner);
    }
}

#[tauri::command]
pub fn query_desktop_media_write_permission(
    window: WebviewWindow,
    path: String,
    directory: bool,
) -> Result<String, String> {
    require_app_window(&window)?;
    let allowed = if directory {
        fs::metadata(path).is_ok_and(|metadata| metadata.is_dir())
    } else {
        OpenOptions::new().write(true).open(path).is_ok()
    };
    Ok(if allowed { "granted" } else { "denied" }.into())
}

#[tauri::command]
pub fn access_desktop_media_entry(
    window: WebviewWindow,
    path: String,
    directory: bool,
    create: bool,
) -> Result<String, String> {
    require_app_window(&window)?;
    let path = Path::new(&path);
    if !path.is_absolute() {
        return Err("File access requires an absolute path".into());
    }
    if create {
        let parent = path.parent().ok_or("The entry has no parent")?;
        canonical_path(parent, true)?;
        if directory {
            if let Err(error) = fs::create_dir(path) {
                if error.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(io_error(error));
                }
            }
        } else {
            OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .open(path)
                .map_err(io_error)?;
        }
    }
    if !path.exists() {
        return Err("NotFoundError: The entry is unavailable".into());
    }
    canonical_path(path, directory)
}

fn begin_write(path: &Path, owner: String, keep_existing: bool) -> Result<String, String> {
    let path = PathBuf::from(canonical_path(path, false)?);
    let metadata = fs::metadata(&path).map_err(io_error)?;
    let modified = metadata.modified().map_err(io_error)?;
    let mut entries = writes().lock().map_err(|error| error.to_string())?;
    if entries.len() >= 32 {
        return Err("Too many pending native writes".into());
    }
    if entries.values().any(|entry| {
        entry
            .path
            .to_string_lossy()
            .eq_ignore_ascii_case(&path.to_string_lossy())
    }) {
        return Err("The file already has a pending write".into());
    }
    let token = format!(
        "{}-{}",
        std::process::id(),
        NEXT_WRITE.fetch_add(1, Ordering::Relaxed)
    );
    let temporary = path.with_file_name(format!(".izci-write-{token}.tmp"));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(io_error)?;
    let mut entry = PendingWrite {
        owner,
        path,
        temporary,
        file: Some(file),
        size: metadata.len(),
        modified,
    };
    if keep_existing {
        let mut source = File::open(&entry.path).map_err(io_error)?;
        std::io::copy(&mut source, entry.file.as_mut().unwrap()).map_err(io_error)?;
        entry
            .file
            .as_mut()
            .unwrap()
            .seek(SeekFrom::Start(0))
            .map_err(io_error)?;
    }
    entries.insert(token.clone(), entry);
    Ok(token)
}

#[tauri::command]
pub async fn begin_desktop_media_write(
    window: WebviewWindow,
    path: String,
    keep_existing_data: bool,
) -> Result<String, String> {
    require_app_window(&window)?;
    let owner = window.label().to_string();
    let token = tauri::async_runtime::spawn_blocking(move || {
        begin_write(Path::new(&path), owner, keep_existing_data)
    })
    .await
    .map_err(|error| error.to_string())??;
    if window
        .app_handle()
        .get_webview_window(window.label())
        .is_none()
    {
        abort_owner(window.label());
        return Err("The editing window was closed".into());
    }
    Ok(token)
}

#[tauri::command]
pub fn update_desktop_media_write(
    window: WebviewWindow,
    token: String,
    operation: String,
    bytes: Vec<u8>,
    position: u64,
) -> Result<(), String> {
    require_app_window(&window)?;
    if bytes.len() > 256 * 1024 {
        return Err("Native write chunk exceeds its limit".into());
    }
    let mut entries = writes().lock().map_err(|error| error.to_string())?;
    let entry = entries
        .get_mut(&token)
        .filter(|entry| entry.owner == window.label())
        .ok_or("The native write is unavailable")?;
    let file = entry.file.as_mut().ok_or("The native write is closed")?;
    match operation.as_str() {
        "write" => file.write_all(&bytes).map_err(io_error),
        "seek" => file
            .seek(SeekFrom::Start(position))
            .map(|_| ())
            .map_err(io_error),
        "truncate" => file.set_len(position).map_err(io_error),
        _ => Err("Unsupported native write operation".into()),
    }
}

fn finish_write(token: &str, owner: &str, commit: bool) -> Result<(), String> {
    let mut entries = writes().lock().map_err(|error| error.to_string())?;
    if !entries.get(token).is_some_and(|entry| entry.owner == owner) {
        return Err("The native write is unavailable".into());
    }
    let mut entry = entries.remove(token).unwrap();
    if !commit {
        return Ok(());
    }
    entry
        .file
        .take()
        .ok_or("The native write is closed")?
        .sync_all()
        .map_err(io_error)?;
    let current = fs::metadata(&entry.path).map_err(io_error)?;
    if current.len() != entry.size || current.modified().map_err(io_error)? != entry.modified {
        return Err("ExternalChangeError: The file changed during the native write".into());
    }
    // ReplaceFile preserves the original Windows ACL and commits the sibling atomically.
    unsafe {
        ReplaceFileW(
            &HSTRING::from(entry.path.as_os_str()),
            &HSTRING::from(entry.temporary.as_os_str()),
            None,
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn finish_desktop_media_write(
    window: WebviewWindow,
    token: String,
    commit: bool,
) -> Result<(), String> {
    require_app_window(&window)?;
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || finish_write(&token, &owner, commit))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn move_desktop_media_file(
    window: WebviewWindow,
    path: String,
    destination: String,
) -> Result<String, String> {
    require_app_window(&window)?;
    let source = PathBuf::from(canonical_path(Path::new(&path), false)?);
    let destination = Path::new(&destination);
    if !destination.is_absolute() {
        return Err("Renaming requires an absolute destination".into());
    }
    let parent = canonical_path(
        destination
            .parent()
            .ok_or("The destination has no parent")?,
        true,
    )?;
    let original_parent = canonical_path(source.parent().unwrap(), true)?;
    if !parent.eq_ignore_ascii_case(&original_parent) {
        return Err("Renaming must stay in the original directory".into());
    }
    // MoveFile never replaces an existing destination, including a collision after preflight.
    unsafe {
        MoveFileW(
            &HSTRING::from(source.as_os_str()),
            &HSTRING::from(destination.as_os_str()),
        )
    }
    .map_err(|error| error.to_string())?;
    canonical_path(destination, false)
}

#[tauri::command]
pub fn remove_desktop_media_entry(window: WebviewWindow, path: String) -> Result<(), String> {
    require_app_window(&window)?;
    let path = Path::new(&path);
    if !path.is_absolute() {
        return Err("Removing an entry requires an absolute path".into());
    }
    canonical_path(path.parent().ok_or("The entry has no parent")?, true)?;
    // Remove the entry itself, rather than following a possible file symlink.
    fs::remove_file(path).map_err(io_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_writes_commit_abort_and_reject_external_changes() {
        let root = std::env::temp_dir().join(format!("izci-native-write-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("şarkı.flac");
        fs::write(&path, b"original").unwrap();
        let token = begin_write(&path, "test".into(), false).unwrap();
        writes()
            .lock()
            .unwrap()
            .get_mut(&token)
            .unwrap()
            .file
            .as_mut()
            .unwrap()
            .write_all(b"edited")
            .unwrap();
        assert!(finish_write(&token, "other", true).is_err());
        finish_write(&token, "test", true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"edited");
        let token = begin_write(&path, "test".into(), false).unwrap();
        finish_write(&token, "test", false).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"edited");
        let token = begin_write(&path, "test".into(), false).unwrap();
        fs::write(&path, b"external change").unwrap();
        assert!(finish_write(&token, "test", true)
            .unwrap_err()
            .starts_with("ExternalChangeError:"));
        assert_eq!(fs::read(&path).unwrap(), b"external change");
        begin_write(&path, "test".into(), false).unwrap();
        abort_owner("test");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
