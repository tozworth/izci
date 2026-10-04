export type PlatformId = 'pwa' | 'desktop' | 'android';

export interface PlatformCapabilities {
  serviceWorkerUpdates: boolean;
  appInstallation: boolean;
  windowControlsOverlay: boolean;
  /** Native windows navigate directly; browser popups are primed first. */
  directPopupNavigation: boolean;
  warmOptionsWindow: boolean;
  unrestrictedSignalingHttp: boolean;
}
