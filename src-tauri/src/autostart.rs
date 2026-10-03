use std::{io::ErrorKind, path::Path};
use tauri::WebviewWindow;
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_NAME: &str = "izci";
const BOOT_ARGUMENT: &str = "--autostart";

pub fn is_boot_launch(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().skip(1).any(|arg| arg == BOOT_ARGUMENT)
}

fn launch_command(executable: &Path) -> String {
    format!("\"{}\" {BOOT_ARGUMENT}", executable.display())
}

#[tauri::command]
pub async fn configure_desktop_autostart(
    window: WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the playback owner configures launch on boot".into());
    }
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(RUN_KEY)
        .map_err(|error| error.to_string())?;
    if enabled {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let command = launch_command(&executable);
        // Refresh portable executable paths, but avoid rewriting the Run entry
        // on every boot when it already points to this executable.
        if key.get_value::<String, _>(RUN_NAME).ok().as_ref() != Some(&command) {
            key.set_value(RUN_NAME, &command)
                .map_err(|error| error.to_string())?;
        }
    } else if let Err(error) = key.delete_value(RUN_NAME) {
        if error.kind() != ErrorKind::NotFound {
            return Err(error.to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_command_quotes_portable_paths_and_marks_boot_launches() {
        assert_eq!(
            launch_command(Path::new("C:\\Music Apps\\izci.exe")),
            "\"C:\\Music Apps\\izci.exe\" --autostart"
        );
        assert!(is_boot_launch(["izci.exe".into(), "--autostart".into()]));
        assert!(!is_boot_launch(["izci.exe".into()]));
        assert!(!is_boot_launch([
            "izci.exe".into(),
            "--open".into(),
            "C:\\music\\track.flac".into()
        ]));
        assert!(!is_boot_launch(["--autostart".into()]));
        assert!(!is_boot_launch([
            "izci.exe".into(),
            "--autostart-other".into()
        ]));
    }
}
