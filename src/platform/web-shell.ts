export { invitationOrigin as getPublicInvitationOrigin } from './public-origin';
import { windowFullscreen } from '$lib/services/window-fullscreen';
import { writable, readable } from 'svelte/store';
import type { AppInstallState, AppInstallEnvironment } from './app-install-types';
import type { PwaUpdateCheckState } from './update-types';
import type { PwaUpdateStatus } from '$lib/types';
import { DEFAULT_STATE as NO_OVERLAY } from './window-controls-overlay-types';
import type { MiniPlayerController, MiniPlayerControllerOptions } from '$lib/services/mini-player-types';
import type { PlatformIntegrationOptions } from '$lib/services/platform-integration-types';
import type { BuiltinSignalingOptions, BuiltinSignalingReady, SignalingSocket } from '$lib/services/platform-signaling-types';
import { readBrowserWindowGeometry, applyBrowserWindowBounds } from '$lib/services/window-geometry';
import type { WindowBounds, WindowGeometry } from '$lib/services/window-geometry';

export const platformFullscreen: import('$lib/services/oda-session').OdaFullscreenAdapter = windowFullscreen;

export async function readWindowGeometry(): Promise<WindowGeometry | null> { return readBrowserWindowGeometry(); }
export async function applyWindowBounds(bounds: WindowBounds): Promise<void> { applyBrowserWindowBounds(bounds); }


export const hasBuiltinSignaling: boolean = false;
export async function startBuiltinSignaling(_options: BuiltinSignalingOptions): Promise<BuiltinSignalingReady> {
  throw new Error('Built-in signaling is unavailable in this build.');
}
export async function stopBuiltinSignaling(_endpoint?: string): Promise<void> {}
export function isBuiltinSignalingEndpoint(_endpoint: string): boolean { return false; }
export function fetchSignaling(url: string, init?: RequestInit): Promise<Response> { return fetch(url, init); }
export function createSignalingSocket(url: string): SignalingSocket { return new WebSocket(url); }

export const PlatformAppearanceSettings: import('svelte').ComponentType<import('svelte').SvelteComponent<Record<string, never>>> | null = null;
export const PlatformTrackSettings: import('svelte').ComponentType<import('svelte').SvelteComponent<Record<string, never>>> | null = null;
export function resetPlatformAppearance(): void {}
export function resetPlatformTracks(): void {}
export function createPlatformIntegration(_options: PlatformIntegrationOptions): () => void { return () => undefined; }

export const PlatformWindowControls: import('svelte').ComponentType<import('svelte').SvelteComponent<{ miniPlayerSupported?: boolean; miniPlayerActive?: boolean }>> | null = null;

export function platformTitlebar(_node: HTMLElement, _enabled: boolean): void {}

export async function initializePlatformWindow(): Promise<void> {}

export function presentPlatformPopup(_path: string): boolean { return false; }


export function createPlatformMiniPlayerController(
  _options: MiniPlayerControllerOptions
): MiniPlayerController | null {
  return null;
}

export function exitPlatform(): boolean {
  return false;
}

export const localFonts = { supported: () => false, hasPermission: async () => false, query: async (): Promise<string[]> => [] };

export function consumeFileLaunchMarker(): boolean { return false; }
export function setLaunchedHandlesPreviewListener(_listener: ((handles: FileSystemFileHandle[]) => void) | null): void {}
export function subscribeToLaunchedFiles(_listener: (files: File[]) => void | Promise<void>): () => void { return () => undefined; }

export const pwaUpdateStatus = writable<PwaUpdateStatus>('idle');
export const pwaUpdateCheckState = writable<PwaUpdateCheckState>({ status: 'idle', lastSuccessfulCheck: null });
export async function forceServiceWorkerUpdateCheck(): Promise<void> {}
export async function checkServiceWorkerUpdate(): Promise<void> {}
export async function applyAvailableServiceWorkerUpdate(): Promise<void> {}
export async function registerAppServiceWorker(): Promise<void> {}

export function createAppInstallService(_environment: AppInstallEnvironment = {}) {
  const store = readable<AppInstallState>({ available: false, showHint: false });
  return { subscribe: store.subscribe, markEngaged() {}, acknowledgeHint() {},
    prompt: async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => 'unavailable', destroy() {} };
}
export const appInstallService = createAppInstallService();
export const windowControlsOverlayState = readable(NO_OVERLAY);
