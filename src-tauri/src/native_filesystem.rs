use std::{fs, io, path::Path};
use tauri::WebviewWindow;

pub(crate) fn require_app_window(window: &WebviewWindow) -> Result<(), String> {
    if window
        .url()
        .is_ok_and(|url| crate::windows::is_app_url(&url))
    {
        Ok(())
    } else {
        Err("File access is only available to packaged izci windows".into())
    }
}

pub(crate) fn canonical_path(path: &Path, folder: bool) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("File access requires an absolute path".into());
    }
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    if if folder {
        !metadata.is_dir()
    } else {
        !metadata.is_file()
    } {
        return Err("The selected filesystem entry is unavailable".into());
    }
    let value = path.to_str().ok_or("The path is not valid Unicode")?;
    Ok(if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        value.strip_prefix("\\\\?\\").unwrap_or(value).to_string()
    })
}

// Do not follow junctions/symlinks: they can escape the selected root or loop.
fn linked_directory(entry: &fs::DirEntry) -> io::Result<bool> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        Ok(entry.file_type()?.is_symlink() || entry.metadata()?.file_attributes() & 0x400 != 0)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(entry.file_type()?.is_symlink())
    }
}

fn collect_folder(
    path: &Path,
    max_depth: u32,
    depth: u32,
    files: &mut Vec<String>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_file() {
            // Unknown extensions still go through the shared muted module probe.
            files.push(canonical_path(&entry.path(), false)?);
        } else if kind.is_dir()
            && depth < max_depth
            && !linked_directory(&entry).map_err(|error| error.to_string())?
        {
            collect_folder(&entry.path(), max_depth, depth + 1, files)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn read_desktop_folder(
    window: WebviewWindow,
    path: String,
    max_depth: u32,
) -> Result<Vec<String>, String> {
    require_app_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_path(Path::new(&path), true)?;
        let mut files = Vec::new();
        collect_folder(Path::new(&root), max_depth.min(64), 0, &mut files)?;
        Ok(files)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn folder_permission(path: &Path, probe: bool) -> &'static str {
    let check = || -> io::Result<()> {
        if !path.is_absolute() || !fs::metadata(path)?.is_dir() {
            return Err(io::Error::from(io::ErrorKind::NotFound));
        }
        if probe {
            fs::read_dir(path)?;
        }
        Ok(())
    };
    match check() {
        Ok(()) => "granted",
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => "denied",
        Err(_) => "unavailable",
    }
}

#[tauri::command]
pub async fn query_desktop_folder_permission(
    window: WebviewWindow,
    path: String,
    probe: bool,
) -> Result<String, String> {
    require_app_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        folder_permission(Path::new(&path), probe).to_string()
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn pick_desktop_paths(
    window: WebviewWindow,
    folder: bool,
) -> Result<Option<Vec<String>>, String> {
    require_app_window(&window)?;
    #[cfg(target_os = "linux")]
    return crate::linux::file_picker::pick_paths(window, folder).await;
    #[cfg(target_os = "windows")]
    {
        let owner = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
        // A dedicated STA owns the COM dialog and releases all COM objects before exit.
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::spawn(move || crate::native_file_picker::pick_paths(owner, folder))
                .join()
                .map_err(|_| "The file picker was interrupted".to_string())?
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_obey_depth_and_include_unknown_extensions_without_reading_bytes() {
        let root = std::env::temp_dir().join(format!("izci-native-scan-{}", std::process::id()));
        fs::create_dir_all(root.join("nested/deeper")).unwrap();
        for name in [
            "şarkı.FLAC",
            "module.unfamiliar",
            "nested/video.mkv",
            "nested/deeper/song.hvl",
        ] {
            fs::write(root.join(name), []).unwrap();
        }
        let mut files = Vec::new();
        collect_folder(&root, 0, 0, &mut files).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|path| path.ends_with("module.unfamiliar")));
        files.clear();
        collect_folder(&root, 1, 0, &mut files).unwrap();
        assert_eq!(files.len(), 3);
        files.clear();
        collect_folder(&root, 2, 0, &mut files).unwrap();
        assert_eq!(files.len(), 4);
        assert_eq!(folder_permission(&root, true), "granted");
        assert_eq!(
            folder_permission(&root.join("missing"), true),
            "unavailable"
        );
        assert!(canonical_path(Path::new("relative.flac"), false).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
