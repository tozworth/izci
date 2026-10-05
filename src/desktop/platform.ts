import { invoke } from '@tauri-apps/api/core';
import { hasBuiltinSignaling } from './signaling';
export { readWindowGeometry, applyWindowBounds } from './window-sizing';
export { filesystem } from './filesystem';
export { hasBuiltinSignaling, startBuiltinSignaling, stopBuiltinSignaling, isBuiltinSignalingEndpoint, fetchSignaling, createSignalingSocket } from './signaling';
export { createDesktopMiniPlayerController as createPlatformMiniPlayerController } from './mini-player-controller';
export { default as PlatformWindowControls } from './DesktopWindowControls.svelte';
export { desktopTitlebar as platformTitlebar } from './window-titlebar';
export { initializeDesktopWindow as initializePlatformWindow, presentDesktopPopup as presentPlatformPopup } from './window-lifecycle';
export { default as PlatformAppearanceSettings } from './DesktopAppearanceSettings.svelte';
export { default as PlatformTrackSettings } from './DesktopTrackSettings.svelte';
export { resetDesktopAppearance as resetPlatformAppearance, resetDesktopTracks as resetPlatformTracks } from './settings';
export { createPlatformIntegration } from './system-integration';

export const platformId = 'desktop' as const;
export const platformCapabilities: import('../platform/capabilities').PlatformCapabilities = {
  serviceWorkerUpdates: false, appInstallation: false, windowControlsOverlay: false,
  directPopupNavigation: true, warmOptionsWindow: true,
  unrestrictedSignalingHttp: hasBuiltinSignaling, mediaElementWebAudio: true
};

export function exitPlatform(): boolean {
  void invoke('exit_desktop').catch((error) => console.error('Could not exit izci.', error));
  return true;
}

export { localFonts } from './local-fonts';

export { consumeFileLaunchMarker, setLaunchedHandlesPreviewListener, subscribeToLaunchedFiles,
  pwaUpdateStatus, pwaUpdateCheckState, forceServiceWorkerUpdateCheck, checkServiceWorkerUpdate, applyAvailableServiceWorkerUpdate, registerAppServiceWorker,
  createAppInstallService, appInstallService, windowControlsOverlayState } from '../platform/web-shell';
export { packagedInvitationOrigin as getPublicInvitationOrigin } from '../platform/public-origin';
