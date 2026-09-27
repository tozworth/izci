import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  return { values };
});

import type { MenuActionItem } from '$lib/types';
import { buildMenuItems } from './menu-items';
import type { MenuTranslation } from './menu-format';
import type { MultiplayerConnectionStats, MultiplayerConnectionStatus, MultiplayerMode } from '$lib/services/multiplayer-types';

const translate: MenuTranslation = (_id, options) => options?.default ?? String(_id);
type MenuItemsDeps = Parameters<typeof buildMenuItems>[0];
type MenuItemsResult = ReturnType<typeof buildMenuItems>;

const baseDeps = (): MenuItemsDeps => ({
  translate,
  multiplayerMode: 'idle',
  multiplayerFreeplayEnabled: false,
  multiplayerInviteCode: null,
  multiplayerClients: [],
  multiplayerConnectionStatus: 'idle',
  multiplayerHostName: null,
  multiplayerAudioStatus: 'idle',
  multiplayerConnectionRoute: null,
  multiplayerAudioBitrateKbps: null,
  multiplayerFreeplay: false,
  multiplayerReceiveAudio: true,
  multiplayerHostVersion: null,
  multiplayerHostImplementation: null,
  multiplayerHostProtocol: null,
  multiplayerConnectionStats: null,
  multiplayerEnabled: true,
  playingTrack: null,
  installAvailable: false,
  showInstallHint: false,
  installHintPresentedInOpenMenu: false,
  miniPlayerSupported: false,
  miniPlayerActive: false,
  nowPlayingViewActive: false,
  openWorkspaceTabs: [],
  visualMediaActive: false,
  mediaTabKind: 'video',
  videoActive: false,
  videoFitMode: 'contain',
  videoPictureInPictureSupported: false,
  videoTheaterActive: false,
  pwaUpdateStatus: 'idle',
  playbackSettings: { playbackRate: 1, trueSpeed: false, stopAfterTrack: false } as MenuItemsDeps['playbackSettings'],
  rafSettings: { enabled: true, effects: [] },
  abLoop: { active: false, start: null, end: null },
  sleepTimer: { active: false, endTime: null, durationMinutes: null, remainingSeconds: null },
  loadouts: { automaticEnabled: true, loadouts: [] },
  rafPresets: { presets: [], selectedPresetId: null }
});

function ids(items: MenuActionItem[]): string[] {
  return items.map((item) => item.id);
}

function groupIds(result: MenuItemsResult): string[] {
  return result.menuGroups.map((group) => group.id);
}

function groupItems(result: MenuItemsResult, id: string): MenuActionItem[] {
  return result.menuGroups.find((group) => group.id === id)?.items ?? [];
}

describe('menu-items builders', () => {
  beforeEach(() => {
    storage.values.clear();
  });

  it('builds a file menu with open actions', () => {
    const result = buildMenuItems(baseDeps());
    expect(ids(groupItems(result, 'file'))).toEqual(['openFiles', 'openFolder', 'manageFolders']);
  });

  it('includes the video group only when a video is active', () => {
    const result = buildMenuItems(baseDeps());
    expect(groupIds(result)).not.toContain('video');

    const withVideo = buildMenuItems({ ...baseDeps(), videoActive: true });
    expect(groupIds(withVideo)).toContain('video');
    expect(ids(groupItems(withVideo, 'video'))).toEqual(['videoFitContain', 'videoFitCover', 'toggleVideoTheater']);
  });

  it('swaps the file group for a session group in client mode', () => {
    const result = buildMenuItems({
      ...baseDeps(),
      multiplayerMode: 'client' as MultiplayerMode,
      multiplayerConnectionStatus: 'connected' as MultiplayerConnectionStatus,
      multiplayerHostName: 'Other Device',
      multiplayerConnectionStats: { packetsReceived: 10, packetsLost: 1, packetLossPercent: 9.09, bytesReceived: 2048, jitterMs: 5, roundTripTimeMs: 20, codec: 'opus' } as MultiplayerConnectionStats
    });
    expect(groupIds(result)).toContain('session');
    expect(groupIds(result)).not.toContain('file');
  });

  it('only exposes Chat in View while connected to a multiplayer room', () => {
    expect(ids(groupItems(buildMenuItems(baseDeps()), 'view'))).not.toContain('showChat');
    expect(ids(groupItems(buildMenuItems({
      ...baseDeps(),
      multiplayerMode: 'client',
      multiplayerConnectionStatus: 'connecting'
    }), 'view'))).not.toContain('showChat');
    expect(ids(groupItems(buildMenuItems({
      ...baseDeps(),
      multiplayerMode: 'hosting',
      multiplayerConnectionStatus: 'connected'
    }), 'view'))).toContain('showChat');
  });

  it('offers server hosting and joining for idle clients', () => {
    const result = buildMenuItems({
      ...baseDeps(),
    });
    const app = result.menuGroups.find((group) => group.id === 'app')!;
    const multiplayer = app.items.find((item) => item.id === 'multiplayer')!;
    expect(ids(multiplayer.children ?? [])).toEqual([
      'multiplayerHost',
      'multiplayerJoin',
      'multiplayerFreeplayPreference',
    ]);
  });

  it('marks the selected playback rate and ab-loop state', () => {
    const result = buildMenuItems({
      ...baseDeps(),
      playingTrack: { id: 't', name: 'A.mp3', extension: 'mp3', kind: 'stream', size: 1, lastModified: 1 },
      playbackSettings: { playbackRate: 1.25, trueSpeed: true, stopAfterTrack: true } as MenuItemsDeps['playbackSettings'],
      abLoop: { active: true, start: 10, end: 20 }
    });
    const playbackItems = groupItems(result, 'playback');
    const speed = playbackItems.find((item) => item.id === 'playbackSpeed')!;
    expect(speed.children?.find((item) => item.id === 'setPlaybackRate:1.25')?.checked).toBe(true);
    const ab = playbackItems.find((item) => item.id === 'abLoopClear')!;
    expect(ab.checked).toBe(true);
  });

  it('applies install attention when a hint is pending', () => {
    const result = buildMenuItems({ ...baseDeps(), installAvailable: true, showInstallHint: true });
    const app = result.menuGroups.find((group) => group.id === 'app')!;
    expect(app.attention).toBe(true);
    const install = app.items.find((item) => item.id === 'installApp')!;
    expect(install.attention).toBe(true);
  });

  it('marks View tabs checked while open so they can be closed from the menu', () => {
    const view = groupItems(buildMenuItems({
      ...baseDeps(),
      openWorkspaceTabs: ['queue', 'lyrics', 'patterns']
    }), 'view');
    const byId = new Map(view.map((item) => [item.id, item]));
    expect(byId.get('showQueue')?.checked).toBe(true);
    expect(byId.get('showLibrary')?.checked).toBe(false);
    expect(byId.get('showTrackDetails')?.checked).toBe(false);
    expect(byId.get('showLyrics')?.checked).toBe(true);
    expect(byId.get('togglePatterns')?.checked).toBe(true);
    expect(ids(view)).not.toContain('toggleMedia');

    const withMedia = groupItems(buildMenuItems({
      ...baseDeps(),
      openWorkspaceTabs: ['media'],
      visualMediaActive: true,
      mediaTabKind: 'video'
    }), 'view');
    expect(ids(withMedia)).toContain('toggleMedia');
    expect(withMedia.find((item) => item.id === 'toggleMedia')?.checked).toBe(true);
  });

  it('builds bookmark menu items with add fallback', () => {
    const bookmarks = groupItems(buildMenuItems(baseDeps()), 'playback')
      .find((item) => item.id === 'bookmarks')!;
    const items = bookmarks.children ?? [];
    expect(ids(items)).toEqual(['bookmark:add']);
    expect(items[0].separatorBefore).toBe(false);
  });
});
