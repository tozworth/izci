import type { MenuActionItem, PlaybackSnapshot } from '$lib/types';
import { isRafMenuAction, type RafMenuAction } from '$lib/services/raf-menu';

export const TRAY_ACTION_EVENT = 'izci:desktop-tray-action';
export const TRAY_STATE_EVENT = 'izci:desktop-tray-state';
export const TRAY_REQUEST_EVENT = 'izci:desktop-tray-request';
export const TRAY_OPEN_EVENT = 'izci:desktop-tray-open';
export const TRAY_VOLUME_STEP_EVENT = 'izci:desktop-tray-volume-step';
export const TRAY_VOLUME_STEP = 0.05;
export interface TrayState { playing: boolean; canControl: boolean }
export type TrayAction = 'togglePlayback' | 'previousTrack' | 'nextTrack' | 'openOptions' | 'enterOda' | 'miniPlayer' | 'exit' | RafMenuAction;
const ACTIONS = new Set<TrayAction>(['togglePlayback', 'previousTrack', 'nextTrack', 'openOptions', 'enterOda', 'miniPlayer', 'exit']);

export function parseTrayAction(value: unknown): TrayAction | null {
  return typeof value === 'string' && (ACTIONS.has(value as TrayAction) || isRafMenuAction(value)) ? value as TrayAction : null;
}

export function trayState(snapshot: PlaybackSnapshot, canControl: boolean): TrayState {
  return { playing: snapshot.state === 'playing', canControl };
}

export function trayItems(state: TrayState, translate: (key: string) => string, rafItems: MenuActionItem[] = []): MenuActionItem[] {
  return [
    { id: 'previousTrack', label: translate('main.player.previousTrack'), icon: 'skip_previous', disabled: !state.canControl },
    { id: 'togglePlayback', label: translate(state.playing ? 'desktop.tray.pause' : 'desktop.tray.play'), icon: state.playing ? 'pause' : 'play_arrow', disabled: !state.canControl },
    { id: 'nextTrack', label: translate('main.player.nextTrack'), icon: 'skip_next', disabled: !state.canControl },
    ...(rafItems.length ? [{ id: 'raf', label: translate('options.views.raf'), icon: 'tune', separatorBefore: true, children: rafItems }] : []),
    { id: 'openOptions', label: translate('main.menu.options'), icon: 'settings', separatorBefore: !rafItems.length },
    { id: 'enterOda', label: translate('desktop.tray.oda'), icon: 'tv', separatorBefore: true },
    { id: 'miniPlayer', label: translate('main.menu.miniPlayer'), icon: 'picture_in_picture_alt' },
    { id: 'exit', label: translate('desktop.tray.exit'), icon: 'close' }
  ];
}
