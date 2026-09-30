import { invoke } from '@tauri-apps/api/core';
export { createDesktopMiniPlayerController } from './mini-player-controller';

export const isDesktop = true;

export function exitDesktop(): boolean {
  void invoke('exit_desktop').catch((error) => console.error('Could not exit izci.', error));
  return true;
}
