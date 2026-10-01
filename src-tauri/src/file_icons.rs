use serde::Deserialize;
use std::{path::Path, sync::LazyLock};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileIcon {
    pub name: String,
    pub kind: String,
    pub extension: Option<String>,
    pub resource_id: u16,
}

static ICONS: LazyLock<Vec<FileIcon>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../icons/file-types/manifest.json"))
        .expect("Desktop file icon manifest")
});

pub fn icon_for(extension: &str, kind: &str) -> Option<&'static FileIcon> {
    ICONS
        .iter()
        .find(|icon| icon.kind == kind && icon.extension.as_deref() == Some(extension))
        .or_else(|| {
            ICONS
                .iter()
                .find(|icon| icon.kind == kind && icon.extension.is_none())
        })
}

pub fn prog_id(extension: &str, kind: &str) -> String {
    let suffix = icon_for(extension, kind).map_or(kind, |icon| icon.name.as_str());
    format!("app.izci.desktop.{suffix}")
}

pub fn icon_location(executable: &Path, extension: &str, kind: &str) -> String {
    // Negative values select a stable resource ID, independent of icon ordering.
    let resource = icon_for(extension, kind).map_or(0, |icon| -i32::from(icon.resource_id));
    format!("\"{}\",{resource}", executable.display())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn dedicated_icons_cover_exactly_the_requested_extensions() {
        let formats = crate::associations::formats();
        let expected: BTreeSet<_> = [
            "mp3", "wav", "flac", "ogg", "opus", "ahx", "hvl", "mptm", "mod", "s3m", "xm", "it",
            "mo3",
        ]
        .into_iter()
        .collect();
        let actual: BTreeSet<_> = ICONS
            .iter()
            .filter_map(|icon| icon.extension.as_deref())
            .collect();
        assert_eq!(actual, expected);
        let mut ids = BTreeSet::new();
        for icon in ICONS.iter() {
            assert!(icon.resource_id > 32512 && ids.insert(icon.resource_id));
            if let Some(extension) = &icon.extension {
                assert_eq!(formats.get(extension), Some(&icon.kind));
            }
            assert!(Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(format!("icons/file-types/{}.ico", icon.name))
                .is_file());
        }
        for (extension, kind) in formats {
            if kind == "stream" {
                assert_eq!(
                    icon_for(&extension, &kind).unwrap().extension.as_deref(),
                    Some(extension.as_str())
                );
            }
        }
    }

    #[test]
    fn other_modules_share_the_document_and_visual_media_keep_the_exe_icon() {
        let executable = Path::new("C:\\Music Player\\izci.exe");
        for (extension, kind) in crate::associations::formats() {
            let location = icon_location(executable, &extension, &kind);
            match kind.as_str() {
                "module" if icon_for(&extension, &kind).unwrap().extension.is_none() => {
                    assert_eq!(prog_id(&extension, &kind), "app.izci.desktop.module");
                    assert_eq!(location, "\"C:\\Music Player\\izci.exe\",-32600");
                }
                "video" | "image" => {
                    assert!(icon_for(&extension, &kind).is_none());
                    assert_eq!(location, "\"C:\\Music Player\\izci.exe\",0");
                    assert_eq!(
                        prog_id(&extension, &kind),
                        format!("app.izci.desktop.{kind}")
                    );
                }
                _ => assert_eq!(
                    prog_id(&extension, &kind),
                    format!("app.izci.desktop.{extension}")
                ),
            }
        }
    }
}
