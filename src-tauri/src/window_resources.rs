use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use windows::core::Interface;

// Native HWND visibility does not update WebView2 controller visibility.
// Hidden utilities keep scripts/events alive, but stop rendering and request a
// smaller working set. Never suspend or hide the playback owner's controller.
pub fn set_active(window: &WebviewWindow, active: bool) {
    if window.label() == "main" {
        return;
    }
    let _ = window.with_webview(move |webview| unsafe {
        let controller = webview.controller();
        let _ = controller.SetIsVisible(active);
        if let Ok(core) = controller
            .CoreWebView2()
            .and_then(|core| core.cast::<ICoreWebView2_19>())
        {
            let level = if active {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            };
            // Older runtimes can lack the memory-target API. Controller
            // visibility remains useful and normal presentation still works.
            let _ = core.SetMemoryUsageTargetLevel(level);
        }
    });
}

pub fn show(window: &WebviewWindow) -> Result<(), String> {
    set_active(window, true);
    window.show().map_err(|error| error.to_string())
}

pub fn hide(window: &WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())?;
    set_active(window, false);
    Ok(())
}
