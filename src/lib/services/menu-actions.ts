import type { TrackItem } from '$lib/types';
import { applyManualLoadoutSettings } from '$lib/services/loadouts';
import { loadouts } from '$lib/stores/loadouts';
import { normalizePlaybackRate, playbackSettings } from '$lib/stores/playback-settings';
import { rafPresets } from '$lib/stores/raf-presets';
import { rafSettings } from '$lib/stores/raf-settings';
import {
  addPlaybackBookmark,
  deletePlaybackBookmark,
  type PlaybackBookmark
} from '$lib/services/playback-bookmarks';
import {
  cancelSleepTimer,
  setSleepTimer
} from '$lib/services/sleep-timer';
import {
  clearAbLoop,
  setAbLoopEnd,
  setAbLoopStart
} from '$lib/services/ab-loop';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

type DispatchedMenuActionId =
  | 'enterOda'
  | 'openFiles'
  | 'openFolder'
  | 'installApp'
  | 'openOptions'
  | 'forceUpdate'
  | 'openAbout'
  | 'openAudioCompare'
  | 'openEditor'
  | 'openConverter'
  | 'openLogs'
  | 'openTroubadour'
  | 'showQueue'
  | 'showLibrary'
  | 'showTrackDetails'
  | 'showLyrics'
  | 'togglePatterns'
  | 'showChat'
  | 'toggleMedia'
  | 'toggleMiniPlayer'
  | 'toggleNowPlayingView'
  | 'multiplayerHost'
  | 'multiplayerHostWithCode'
  | 'multiplayerStopHosting'
  | 'multiplayerJoin'
  | 'multiplayerLeave'
  | 'multiplayerCopyInvite'
  | 'multiplayerResumeAudio'
  | 'exit';
export type MenuActionId =
  | DispatchedMenuActionId
  | 'manageFolders'
  | 'openLoadouts'
  | 'openRaf'
  | 'toggleTrueSpeed'
  | 'toggleRaf'
  | 'toggleStopAfterTrack'
  | 'sleepTimerOff'
  | `sleepTimerSet:${string}`
  | `setPlaybackRate:${string}`
  | `applyRafPreset:${string}`
  | 'bookmark:add'
  | `bookmark:delete:${string}`
  | `bookmark:seek:${string}`
  | 'abLoopSetStart'
  | 'abLoopSetEnd'
  | 'abLoopClear'
  | 'videoFitContain'
  | 'videoFitCover'
  | 'toggleVideoPictureInPicture'
  | 'toggleVideoTheater'
  | 'multiplayerToggleAudio'
  | `multiplayerKick:${string}`
  | `multiplayerTogglePair:${string}`
  | `multiplayerJoinPaired:${string}`
  | `multiplayerForgetPairing:${string}`
  | `multiplayerJoinRecent:${string}`
  | `applyLoadout:${string}`;

interface MenuActionsDeps {
  getPlayingTrack(): TrackItem | null;
  getPlaybackTime(): number;
  getMultiplayerReceiveAudio(): boolean;
  getBookmarks(): PlaybackBookmark[];
  setBookmarks(bookmarks: PlaybackBookmark[]): void;
  dispatch(action: string, detail?: unknown): void;
}

export function createMenuActions(deps: MenuActionsDeps) {
  function runMenuAction(action: MenuActionId) {
    if (action === 'multiplayerToggleAudio') {
      deps.dispatch('multiplayerToggleAudio', !deps.getMultiplayerReceiveAudio());
      return;
    }
    if (action === 'openLoadouts') {
      deps.dispatch('openOptions', { view: 'loadouts' });
      return;
    }
    if (action === 'manageFolders') {
      deps.dispatch('openOptions', { view: 'folders' });
      return;
    }
    if (action.startsWith('applyLoadout:')) {
      const loadoutId = action.slice('applyLoadout:'.length);
      const loadout = loadouts.getSnapshot().loadouts.find((candidate) => candidate.id === loadoutId);
      if (loadout) {
        applyManualLoadoutSettings(loadout.settings);
      }
      return;
    }
    if (action.startsWith('multiplayerKick:')) {
      deps.dispatch('multiplayerKick', action.slice('multiplayerKick:'.length));
      return;
    }
    if (action.startsWith('multiplayerTogglePair:')) {
      deps.dispatch('multiplayerTogglePair', action.slice('multiplayerTogglePair:'.length));
      return;
    }
    if (action.startsWith('multiplayerJoinPaired:')) {
      deps.dispatch('multiplayerJoinPaired', action.slice('multiplayerJoinPaired:'.length));
      return;
    }
    if (action.startsWith('multiplayerForgetPairing:')) {
      deps.dispatch('multiplayerForgetPairing', action.slice('multiplayerForgetPairing:'.length));
      return;
    }
    if (action.startsWith('multiplayerJoinRecent:')) {
      deps.dispatch('multiplayerJoinRecent', action.slice('multiplayerJoinRecent:'.length));
      return;
    }
    if (action === 'videoFitContain' || action === 'videoFitCover') {
      deps.dispatch('setVideoFit', action === 'videoFitContain' ? 'contain' : 'cover');
      return;
    }
    if (action === 'toggleVideoPictureInPicture') {
      deps.dispatch('toggleVideoPictureInPicture');
      return;
    }
    if (action === 'toggleVideoTheater') {
      deps.dispatch('toggleVideoTheater');
      return;
    }
    if (action === 'toggleTrueSpeed') {
      playbackSettings.update({ trueSpeed: !playbackSettings.getSnapshot().trueSpeed });
      return;
    }
    if (action === 'toggleStopAfterTrack') {
      playbackSettings.update({ stopAfterTrack: !playbackSettings.getSnapshot().stopAfterTrack });
      return;
    }
    if (action === 'sleepTimerOff') {
      cancelSleepTimer();
      return;
    }
    if (action.startsWith('sleepTimerSet:')) {
      setSleepTimer(Number(action.slice('sleepTimerSet:'.length)));
      return;
    }
    if (action.startsWith('setPlaybackRate:')) {
      playbackSettings.update({
        playbackRate: normalizePlaybackRate(Number(action.slice('setPlaybackRate:'.length)))
      });
      return;
    }
    if (action === 'toggleRaf') {
      rafSettings.setEnabled(!rafSettings.getSnapshot().enabled);
      return;
    }
    if (action === 'openRaf') {
      deps.dispatch('openOptions', { view: 'raf' });
      return;
    }
    if (action.startsWith('applyRafPreset:')) {
      rafPresets.apply(action.slice('applyRafPreset:'.length));
      return;
    }
    if (action === 'bookmark:add') {
      const playingTrack = deps.getPlayingTrack();
      if (!playingTrack) return;
      const name = window.prompt(get(t)('main.player.bookmarkNamePrompt', { default: 'Name this bookmark:' }));
      if (name === null) return;
      deps.setBookmarks(addPlaybackBookmark(playingTrack, deps.getPlaybackTime(), name));
      return;
    }
    if (action.startsWith('bookmark:delete:')) {
      const playingTrack = deps.getPlayingTrack();
      if (!playingTrack) return;
      deps.setBookmarks(deletePlaybackBookmark(playingTrack, action.slice('bookmark:delete:'.length)));
      return;
    }
    if (action.startsWith('bookmark:seek:')) {
      const playingTrack = deps.getPlayingTrack();
      if (!playingTrack) return;
      const bookmark = deps.getBookmarks().find(({ id }) => id === action.slice('bookmark:seek:'.length));
      if (bookmark) deps.dispatch('seek', bookmark.time);
      return;
    }
    if (action === 'abLoopSetStart') {
      if (!deps.getPlayingTrack()) return;
      setAbLoopStart(deps.getPlaybackTime());
      return;
    }
    if (action === 'abLoopSetEnd') {
      if (!deps.getPlayingTrack()) return;
      setAbLoopEnd(deps.getPlaybackTime());
      return;
    }
    if (action === 'abLoopClear') {
      clearAbLoop();
      return;
    }
    deps.dispatch(action as DispatchedMenuActionId);
  }

  return { runMenuAction };
}
