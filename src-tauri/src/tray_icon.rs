#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopShowIn {
    Taskbar,
    Tray,
    Both,
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopTrayIcon {
    Light,
    Dark,
}

impl DesktopTrayIcon {
    pub fn image(self) -> tauri::image::Image<'static> {
        let color = if matches!(self, Self::Light) { 255 } else { 0 };
        let pixels = include_bytes!("../icons/tray-mark.alpha")
            .iter()
            .flat_map(|&alpha| [color, color, color, alpha])
            .collect();
        tauri::image::Image::new_owned(pixels, 32, 32)
    }
}
