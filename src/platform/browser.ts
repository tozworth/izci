import type { MiniPlayerController, MiniPlayerControllerOptions } from '$lib/services/mini-player-types';
import type { PlatformIntegrationOptions } from '$lib/services/platform-integration-types';
import type { TrackItem } from '$lib/types';

// Vite resolves this module for browser builds. No desktop imports belong here.
export const isDesktop = false;
export const DesktopAppearanceSettings: typeof import('../desktop/DesktopAppearanceSettings.svelte').default | null = null;
export const DesktopTrackSettings: typeof import('../desktop/DesktopTrackSettings.svelte').default | null = null;
export function resetDesktopAppearance(): void {}
export function resetDesktopTracks(): void {}
export function createPlatformIntegration(_options: PlatformIntegrationOptions): () => void { return () => undefined; }
export async function materializePlatformFile(_path: string): Promise<File | null> { return null; }
export async function preparePlaybackRestoration(_track: TrackItem): Promise<void> {}

export const DesktopWindowControls: typeof import('../desktop/DesktopWindowControls.svelte').default | null = null;

export function desktopTitlebar(_node: HTMLElement, _enabled: boolean): void {}

export async function initializeDesktopWindow(): Promise<void> {}

export function presentDesktopPopup(_path: string): boolean { return false; }

export async function queryDesktopFontFamilies(): Promise<string[]> { return []; }

export function createDesktopMiniPlayerController(
  _options: MiniPlayerControllerOptions
): MiniPlayerController | null {
  return null;
}

export function exitDesktop(): boolean {
  return false;
}
