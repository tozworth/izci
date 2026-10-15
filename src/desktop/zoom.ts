import { getCurrentWebview } from '@tauri-apps/api/webview';
import { desktopSettings } from './settings';

let initialized: Promise<void> | undefined;

// Player/tool windows subscribe for their lifetime, including hidden Options.
// Apply the saved zoom before the native surface is first shown.
export function initializeDesktopZoom(): Promise<void> {
  if (initialized) return initialized;
  const webview = getCurrentWebview();
  // The mini player is a fixed-size native surface with its own compact layout.
  if (webview.label === 'mini-player') return initialized = Promise.resolve();
  let applied: number | undefined;
  let work = Promise.resolve();
  desktopSettings.subscribe(({ zoomPercent }) => {
    work = work.then(async () => {
      if (zoomPercent === applied) return;
      await webview.setZoom(zoomPercent / 100);
      applied = zoomPercent;
    }).catch((error) => console.error('Could not apply desktop zoom.', error));
  });
  initialized = work;
  return initialized;
}
