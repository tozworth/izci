import type { PlatformCapabilities } from '../capabilities';
export * from '../web-shell';
export { filesystem } from '../web-filesystem';
export { consumeFileLaunchMarker, setLaunchedHandlesPreviewListener, subscribeToLaunchedFiles } from './file-launch';
export { localFonts } from './local-fonts';

export const platformId = 'pwa' as const;
export const platformCapabilities: PlatformCapabilities = {
  serviceWorkerUpdates: true, appInstallation: true, windowControlsOverlay: true,
  directPopupNavigation: false, warmOptionsWindow: false,
  unrestrictedSignalingHttp: false, mediaElementWebAudio: true
};

export { pwaUpdateStatus, pwaUpdateCheckState, forceServiceWorkerUpdateCheck, checkServiceWorkerUpdate, applyAvailableServiceWorkerUpdate, registerAppServiceWorker } from './updates';
export { appInstallService, createAppInstallService } from './app-install';
export { windowControlsOverlayState } from './window-controls-overlay';
