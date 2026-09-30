import type { MiniPlayerController, MiniPlayerControllerOptions } from '$lib/services/mini-player-types';

// Vite resolves this module for browser builds. No desktop imports belong here.
export const isDesktop = false;

export function createDesktopMiniPlayerController(
  _options: MiniPlayerControllerOptions
): MiniPlayerController | null {
  return null;
}

export function exitDesktop(): boolean {
  return false;
}
