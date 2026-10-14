use crate::file_icons::{icon_for, icon_location, prog_id};
use std::{collections::BTreeMap, path::Path};
use tauri::WebviewWindow;
use windows::{
    core::{w, PCWSTR},
    Win32::UI::{
        Shell::{SHChangeNotify, ShellExecuteW, SHCNE_ASSOCCHANGED, SHCNF_IDLIST},
        WindowsAndMessaging::SW_SHOWNORMAL,
    },
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey, RegValue};

const CAPABILITIES: &str = "Software\\izci\\Capabilities";
const REGISTERED_NAME: &str = "izci";
const CLASSES: &str = "Software\\Classes";

pub fn formats() -> BTreeMap<String, String> {
    serde_json::from_str(include_str!("../media-formats.json"))
        .expect("Canonical desktop media formats")
}

fn open_command(executable: &Path) -> String {
    format!("\"{}\" --open \"%1\"", executable.display())
}

fn configure(enabled: bool) -> Result<(), String> {
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let formats = formats();
    if enabled {
        let capabilities = current_user
            .create_subkey(CAPABILITIES)
            .map_err(|error| error.to_string())?
            .0;
        capabilities
            .set_value("ApplicationName", &"izci")
            .map_err(|error| error.to_string())?;
        capabilities
            .set_value("ApplicationDescription", &"izci music and media player")
            .map_err(|error| error.to_string())?;
        let associations = capabilities
            .create_subkey("FileAssociations")
            .map_err(|error| error.to_string())?
            .0;
        for (extension, kind) in &formats {
            let id = prog_id(extension, kind);
            let label = icon_for(extension, kind)
                .and_then(|icon| icon.extension.as_ref())
                .map_or_else(|| kind.clone(), |extension| extension.to_uppercase());
            associations
                .set_value(format!(".{extension}"), &id)
                .map_err(|error| error.to_string())?;
            let class = current_user
                .create_subkey(format!("{CLASSES}\\{id}"))
                .map_err(|error| error.to_string())?
                .0;
            class
                .set_value("", &format!("izci {label}"))
                .map_err(|error| error.to_string())?;
            class
                .create_subkey("DefaultIcon")
                .map_err(|error| error.to_string())?
                .0
                .set_value("", &icon_location(&executable, extension, kind))
                .map_err(|error| error.to_string())?;
            class
                .create_subkey("shell\\open\\command")
                .map_err(|error| error.to_string())?
                .0
                .set_value("", &open_command(&executable))
                .map_err(|error| error.to_string())?;
            let open_with = current_user
                .create_subkey(format!("{CLASSES}\\.{extension}\\OpenWithProgids"))
                .map_err(|error| error.to_string())?
                .0;
            open_with
                .set_raw_value(
                    &id,
                    &RegValue {
                        bytes: vec![],
                        vtype: winreg::enums::REG_NONE,
                    },
                )
                .map_err(|error| error.to_string())?;
            // Advertise the current registration, without changing an existing
            // UserChoice that may still reference the shared media-kind class.
            let shared_id = format!("app.izci.desktop.{kind}");
            if id != shared_id {
                let _ = open_with.delete_value(shared_id);
            }
        }
        current_user
            .create_subkey("Software\\RegisteredApplications")
            .map_err(|error| error.to_string())?
            .0
            .set_value(REGISTERED_NAME, &CAPABILITIES)
            .map_err(|error| error.to_string())?;
    } else {
        // Remove only izci's entries. Never write extension defaults or UserChoice.
        for (extension, kind) in &formats {
            if let Ok(key) = current_user.open_subkey_with_flags(
                format!("{CLASSES}\\.{extension}\\OpenWithProgids"),
                winreg::enums::KEY_SET_VALUE,
            ) {
                let _ = key.delete_value(prog_id(extension, kind));
                let _ = key.delete_value(format!("app.izci.desktop.{kind}"));
            }
        }
        for (extension, kind) in &formats {
            let _ =
                current_user.delete_subkey_all(format!("{CLASSES}\\{}", prog_id(extension, kind)));
        }
        for kind in ["stream", "module", "video", "image"] {
            let _ = current_user.delete_subkey_all(format!("{CLASSES}\\app.izci.desktop.{kind}"));
        }
        let _ = current_user.delete_subkey_all(CAPABILITIES);
        if let Ok(key) = current_user.open_subkey_with_flags(
            "Software\\RegisteredApplications",
            winreg::enums::KEY_SET_VALUE,
        ) {
            let _ = key.delete_value(REGISTERED_NAME);
        }
    }
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }
    Ok(())
}

#[tauri::command]
pub async fn configure_desktop_associations(
    window: WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the player registers file types".into());
    }
    tauri::async_runtime::spawn_blocking(move || configure(enabled))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn open_desktop_default_apps(window: WebviewWindow) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| configure(true))
        .await
        .map_err(|error| error.to_string())??;
    // Activate the URI through the Windows shell on Tauri's COM-initialized UI
    // thread. Passing it as an explorer.exe argument can open File Explorer.
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    window
        .run_on_main_thread(move || {
            let result = unsafe {
                ShellExecuteW(
                    None,
                    w!("open"),
                    w!("ms-settings:defaultapps?registeredAppUser=izci"),
                    PCWSTR::null(),
                    PCWSTR::null(),
                    SW_SHOWNORMAL,
                )
            }
            .0 as isize;
            let _ = sender.try_send(if result > 32 {
                Ok(())
            } else {
                Err(format!(
                    "Windows could not open Default Apps (shell error {result})"
                ))
            });
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("Default Apps activation was interrupted")?
}

#[cfg(test)]
mod tests {
    #[test]
    fn commands_quote_executable_and_file_paths() {
        assert_eq!(
            super::open_command(std::path::Path::new("C:\\Music Player\\izci.exe")),
            "\"C:\\Music Player\\izci.exe\" --open \"%1\""
        );
    }
    #[test]
    fn every_playback_path_has_associations() {
        let formats = super::formats();
        for (extension, kind) in [
            ("flac", "stream"),
            ("mo3", "module"),
            ("hvl", "module"),
            ("mkv", "video"),
            ("avif", "image"),
            ("jxl", "image"),
        ] {
            assert_eq!(formats.get(extension).map(String::as_str), Some(kind));
        }
        assert!(!formats.contains_key("exe"));
    }
}
