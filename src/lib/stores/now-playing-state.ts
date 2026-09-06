import { createSettingsStore } from './persistent-store';
import { WORKSPACE_TABS, type WorkspaceTab } from '$lib/types';
export type FlyoutSide = 'left' | 'right';
export interface NowPlayingState {
  lyrics: boolean;
  patterns: boolean;
  leftPinned: boolean;
  rightPinned: boolean;
  leftTabs: WorkspaceTab[];
  leftWidth: number;
  rightWidth: number;
}
export function normalizeFlyoutWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(800, Math.max(220, value)) : 400;
}
export function normalizeNowPlayingState(value: unknown): NowPlayingState {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<NowPlayingState>;
  return {
    leftWidth: normalizeFlyoutWidth(v.leftWidth),
    rightWidth: normalizeFlyoutWidth(v.rightWidth),
    lyrics: typeof v.lyrics === 'boolean' ? v.lyrics : true,
    patterns: v.patterns === true,
    leftPinned: v.leftPinned === true,
    rightPinned: v.rightPinned === true,
    leftTabs: Array.isArray(v.leftTabs) ? [...new Set(v.leftTabs.filter(t => WORKSPACE_TABS.includes(t) && t !== 'lyrics' && t !== 'patterns'))] : ['queue', 'library']
  };
}
export const nowPlayingState = createSettingsStore({
  storageKey: 'izci.now-playing-state', channelName: 'izci-now-playing-state',
  defaultValue: normalizeNowPlayingState(null), normalize: normalizeNowPlayingState
});
export function moveNowPlayingTab(tab: WorkspaceTab, side: FlyoutSide) {
  const current = nowPlayingState.getSnapshot();
  nowPlayingState.update({ leftTabs: side === 'left' ? [...current.leftTabs, tab] : current.leftTabs.filter(t => t !== tab) });
}
