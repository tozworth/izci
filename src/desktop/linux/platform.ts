import { invoke } from '@tauri-apps/api/core';
export * from '../../platform/web-shell';
export { filesystem } from './filesystem';
export { default as PlatformWindowControls } from '../DesktopWindowControls.svelte';
export { desktopTitlebar as platformTitlebar } from '../window-titlebar';
export { packagedInvitationOrigin as getPublicInvitationOrigin } from '../../platform/public-origin';

export const platformId = 'desktop' as const;
// WebKit popup creation needs a real destination. Browser-style blank priming
// also depends on animation frames that hidden native windows can throttle.
export const platformCapabilities: import('../../platform/capabilities').PlatformCapabilities = {
  serviceWorkerUpdates: false, appInstallation: false, windowControlsOverlay: false,
  directPopupNavigation: true, warmOptionsWindow: false, unrestrictedSignalingHttp: false,
  mediaElementWebAudio: false
};

export async function initializePlatformWindow(): Promise<void> {
  await invoke('desktop_window_ready');
  window.opener?.postMessage({ type: 'izci:popup-ready' }, window.location.origin);
}

export function exitPlatform(): boolean {
  void invoke('exit_desktop').catch((error) => console.error('Could not exit izci.', error));
  return true;
}
