use windows::{
    core::{w, BOOL},
    Win32::Graphics::DirectWrite::{
        DWriteCreateFactory, IDWriteFactory, DWRITE_FACTORY_TYPE_SHARED,
    },
};

fn families() -> windows::core::Result<Vec<String>> {
    // DirectWrite supplies installed system and per-user font families without
    // involving WebView2's browser permission UI or reading any font files.
    unsafe {
        let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
        let mut collection = None;
        factory.GetSystemFontCollection(&mut collection, true)?;
        let Some(collection) = collection else {
            return Ok(Vec::new());
        };
        let mut families = Vec::new();
        for index in 0..collection.GetFontFamilyCount() {
            let names = collection.GetFontFamily(index)?.GetFamilyNames()?;
            let mut name_index = 0;
            let mut exists = BOOL(0);
            // Stable CSS family names regardless of the Windows UI language.
            names.FindLocaleName(w!("en-us"), &mut name_index, &mut exists)?;
            if !exists.as_bool() {
                name_index = 0;
            }
            let length = names.GetStringLength(name_index)? as usize;
            let mut buffer = vec![0; length + 1];
            names.GetString(name_index, &mut buffer)?;
            let family = String::from_utf16_lossy(&buffer[..length]);
            if !family.trim().is_empty() {
                families.push(family);
            }
        }
        families.sort_unstable();
        families.dedup();
        Ok(families)
    }
}

#[tauri::command]
pub async fn local_font_families() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| families().map_err(|error| error.to_string()))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    fn installed_fonts_are_available_without_a_webview() {
        let families = super::families().expect("Windows font collection");
        assert!(!families.is_empty());
        assert!(families.iter().any(|family| family == "Segoe UI"));
        assert!(families.windows(2).all(|pair| pair[0] < pair[1]));
    }
}
