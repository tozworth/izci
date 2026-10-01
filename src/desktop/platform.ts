import { invoke } from '@tauri-apps/api/core';
export { hasBuiltinSignaling, startBuiltinSignaling, stopBuiltinSignaling, isBuiltinSignalingEndpoint, fetchSignaling, createSignalingSocket } from './signaling';
export { createDesktopMiniPlayerController } from './mini-player-controller';
export { default as DesktopWindowControls } from './DesktopWindowControls.svelte';
export { desktopTitlebar } from './window-titlebar';
export { initializeDesktopWindow, presentDesktopPopup, queryDesktopFontFamilies } from './window-lifecycle';
export { default as DesktopAppearanceSettings } from './DesktopAppearanceSettings.svelte';
export { default as DesktopTrackSettings } from './DesktopTrackSettings.svelte';
export { resetDesktopAppearance, resetDesktopTracks } from './settings';
export { createPlatformIntegration } from './system-integration';
export { materializePlatformFile, preparePlaybackRestoration } from './files';

export const isDesktop = true;

export function exitDesktop(): boolean {
  void invoke('exit_desktop').catch((error) => console.error('Could not exit izci.', error));
  return true;
}
