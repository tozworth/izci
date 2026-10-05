import type { PlatformCapabilities } from '../platform/capabilities';
export * from '../platform/web-shell';
export { filesystem } from './files';

export const platformId = 'android' as const;
export const platformCapabilities: PlatformCapabilities = {
  serviceWorkerUpdates: false, appInstallation: false, windowControlsOverlay: false,
  directPopupNavigation: false, warmOptionsWindow: false,
  unrestrictedSignalingHttp: false, mediaElementWebAudio: true
};
export { packagedInvitationOrigin as getPublicInvitationOrigin } from '../platform/public-origin';
