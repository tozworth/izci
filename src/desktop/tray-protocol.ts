import type { MenuActionItem, PlaybackSnapshot } from '$lib/types';

export const TRAY_ACTION_EVENT = 'izci:desktop-tray-action';
export const TRAY_STATE_EVENT = 'izci:desktop-tray-state';
export const TRAY_REQUEST_EVENT = 'izci:desktop-tray-request';
export const TRAY_OPEN_EVENT = 'izci:desktop-tray-open';
export interface TrayState { playing: boolean; canControl: boolean }
export type TrayAction = 'togglePlayback' | 'previousTrack' | 'nextTrack' | 'open' | 'openOptions' | 'miniPlayer' | 'exit';
const ACTIONS = new Set<TrayAction>(['togglePlayback', 'previousTrack', 'nextTrack', 'open', 'openOptions', 'miniPlayer', 'exit']);

export function parseTrayAction(value: unknown): TrayAction | null {
  return typeof value === 'string' && ACTIONS.has(value as TrayAction) ? value as TrayAction : null;
}

export function trayState(snapshot: PlaybackSnapshot, canControl: boolean): TrayState {
  return { playing: snapshot.state === 'playing', canControl };
}

export function trayItems(state: TrayState, translate: (key: string) => string): MenuActionItem[] {
  return [
    { id: 'togglePlayback', label: translate(state.playing ? 'desktop.tray.pause' : 'desktop.tray.play'), icon: state.playing ? 'pause' : 'play_arrow', disabled: !state.canControl },
    { id: 'previousTrack', label: translate('main.player.previousTrack'), icon: 'skip_previous', disabled: !state.canControl },
    { id: 'nextTrack', label: translate('main.player.nextTrack'), icon: 'skip_next', disabled: !state.canControl },
    { id: 'open', label: translate('desktop.tray.open'), icon: 'open_in_new', separatorBefore: true },
    { id: 'openOptions', label: translate('main.menu.options'), icon: 'settings' },
    { id: 'miniPlayer', label: translate('main.menu.miniPlayer'), icon: 'picture_in_picture_alt', separatorBefore: true },
    { id: 'exit', label: translate('desktop.tray.exit'), icon: 'close' }
  ];
}
