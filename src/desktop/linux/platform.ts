import { invoke } from '@tauri-apps/api/core';
export * from '../../platform/web-shell';
export { filesystem } from './filesystem';
export { default as PlatformWindowControls } from '../DesktopWindowControls.svelte';
export { desktopTitlebar as platformTitlebar } from '../window-titlebar';
export { packagedInvitationOrigin as getPublicInvitationOrigin } from '../../platform/public-origin';

export const platformId = 'desktop' as const;
export const platformCapabilities: import('../../platform/capabilities').PlatformCapabilities = {
  serviceWorkerUpdates: false, appInstallation: false, windowControlsOverlay: false,
  directPopupNavigation: false, warmOptionsWindow: false, unrestrictedSignalingHttp: false
};

export async function initializePlatformWindow(): Promise<void> {
  await invoke('desktop_window_ready');
  window.opener?.postMessage({ type: 'izci:popup-ready' }, window.location.origin);
}

export function exitPlatform(): boolean {
  void invoke('exit_desktop').catch((error) => console.error('Could not exit izci.', error));
  return true;
}
