import { invoke } from '@tauri-apps/api/core';
import type { OdaFullscreenAdapter } from '$lib/services/oda-session';
import { windowFullscreen } from '$lib/services/window-fullscreen';

// Native tray actions carry no DOM user activation. Oda uses the native window
// instead, including for menu entry, so it can restore the same fullscreen state.
export const platformFullscreen: OdaFullscreenAdapter = {
  isFullscreen: () => invoke<boolean>('read_desktop_fullscreen'),
  async enter() {
    try {
      await invoke('set_desktop_fullscreen', { enabled: true });
      return true;
    } catch {
      return false;
    }
  },
  async exit() {
    // A DOM fullscreen session may have been started by video during Oda.
    if (windowFullscreen.isFullscreen() && !await windowFullscreen.exit()) return false;
    try {
      await invoke('set_desktop_fullscreen', { enabled: false });
      return true;
    } catch {
      return false;
    }
  }
};
