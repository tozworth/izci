import { invoke } from '@tauri-apps/api/core';
import { tick } from 'svelte';
import { desktopSettings } from './settings';

export async function initializeDesktopWindow(): Promise<void> {
  await tick();
  // Flush mounted content before exposing the native surface. Hidden WebView2
  // windows can throttle animation frames, so a timer must also release it.
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 100);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      window.clearTimeout(timer);
      resolve();
    }));
  });
  const { showIn, trayIcon } = desktopSettings.getSnapshot();
  await invoke('desktop_window_ready', { showIn, trayIcon });
  window.opener?.postMessage({ type: 'izci:popup-ready' }, window.location.origin);
}

export function presentDesktopPopup(path: string): boolean {
  void invoke('present_desktop_popup', { path }).catch((error) => {
    console.error('Could not show desktop tool window.', error);
  });
  return true;
}

let fontFamilies: Promise<string[]> | undefined;

export function queryDesktopFontFamilies(): Promise<string[]> {
  fontFamilies ??= invoke<string[]>('local_font_families').catch((error) => {
    fontFamilies = undefined;
    throw error;
  });
  return fontFamilies;
}
