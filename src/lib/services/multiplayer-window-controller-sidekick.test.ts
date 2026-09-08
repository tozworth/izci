import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMultiplayerWindowController } from './multiplayer-window-controller';
import { sidekickSetup } from './multiplayer-sidekick-setup';
import { buildSidekickInvitationPayload } from './multiplayer-sidekick-invite';
import type { MultiplayerSettings } from '$lib/types';

const ROOM = 'd'.repeat(32);

function settings(overrides: Partial<MultiplayerSettings> = {}): MultiplayerSettings {
  return {
    multiplayer: true,
    izciName: 'Test',
    multiplayerTransport: 'rtdb',
    multiplayerSidekickEndpoint: '',
    multiplayerSidekickLabel: '',
    multiplayerSidekickNoticeVersion: 1,
    multiplayerSidekickAutoReconnect: false,
    multiplayerSidekickForceRelay: false,
    multiplayerSidekickIceAck: '',
    multiplayerMotd: '',
    multiplayerChatHistoryLines: 0,
    multiplayerWaitForClients: false,
    multiplayerSynchronizedPlayback: false,
    multiplayerSyncLeadTimeMs: 1_000,
    multiplayerAutoHost: false,
    multiplayerRestoreLastSession: true,
    multiplayerTurnUrl: '',
    multiplayerTurnSecret: '',
    multiplayerTurnCredentialHours: 12,
    multiplayerForceTurn: false,
    multiplayerFreeplay: false,
    multiplayerStreamAudio: true,
    multiplayerFileTransferLimitMiB: 0,
    multiplayerOpusBitrateKbps: 128,
    multiplayerAudioBufferMs: 3_000,
    multiplayerRenderCacheLimitMiB: 256,
    multiplayerRenderDiskCacheEnabled: true,
    multiplayerRenderDiskCacheLimitMiB: 1024,
    multiplayerMaxListeners: 4,
    ...overrides
  };
}

function deps(overrides: {
  multiplayerSettings?: MultiplayerSettings;
  session?: Record<string, ReturnType<typeof vi.fn>>;
} = {}) {
  const session = {
    startHosting: vi.fn(async () => 'abcd1234'),
    join: vi.fn(async () => undefined),
    joinPaired: vi.fn(async () => undefined),
    restoreLastSession: vi.fn(async () => null),
    leave: vi.fn(async () => undefined),
    stopHosting: vi.fn(async () => undefined),
    ...(overrides.session ?? {})
  };
  const current = overrides.multiplayerSettings ?? settings();
  return {
    session,
    controller: createMultiplayerWindowController({
      getSession: () => session as never,
      getPlaybackCommands: () => ({
        togglePlayback: () => undefined,
        play: () => undefined,
        pause: () => undefined,
        stop: () => undefined,
        stepTrack: () => undefined,
        activateQueueTrack: () => undefined,
        activateLibraryTrack: () => undefined,
        activateFavoriteTrack: () => undefined
      }),
      getPlayingTrack: () => null,
      getPlaybackSnapshot: () => ({
        state: 'idle',
        currentTime: 0,
        duration: 0,
        volume: 1,
        muted: false,
        backend: null
      }) as never,
      getQueueItems: () => [],
      getLibraryItems: () => [],
      getFavoriteItems: () => [],
      playQueueItemsNext: () => undefined,
      seek: () => undefined,
      toggleQueueShuffle: () => undefined,
      cycleQueueRepeat: () => undefined,
      getMultiplayerSettings: () => current,
      getLastSession: () => null,
      getPairings: () => [],
      pausePlayer: () => undefined,
      setActiveWorkspaceTab: () => undefined,
      getRemoteSelections: () => ({ track: { ids: [], anchorId: null, focusId: null }, library: { ids: [], anchorId: null, focusId: null }, favorites: { ids: [], anchorId: null, focusId: null } }) as never,
      setRemoteSelections: () => undefined,
      translate: ((id: string) => id) as never
    })
  };
}

afterEach(() => {
  sidekickSetup.dismissPending();
  sidekickSetup.closeSetup();
  delete (globalThis as Record<string, unknown>)['window'];
});

function stubWindow(hash: string): { prompted: string[] } {
  const prompted: string[] = [];
  const listeners: Record<string, () => void> = {};
  (globalThis as Record<string, unknown>)['window'] = {
    location: { hash, pathname: '/', search: '' },
    history: {
      replaceState: (_a: unknown, _b: string, url: string) => {
        ((globalThis as Record<string, unknown>)['window'] as { location: { hash: string } }).location.hash = '';
        void url;
      }
    },
    prompt: (message: string) => {
      prompted.push(message);
      return null;
    },
    addEventListener: (event: string, listener: () => void) => {
      listeners[event] = listener;
    },
    clearTimeout: (id: number) => clearTimeout(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms)
  };
  return { prompted };
}

describe('multiplayer window controller sidekick routing', () => {
  it('keeps sidekick auto-host silent on launch', async () => {
    stubWindow('');
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayerTransport: 'sidekick', multiplayerAutoHost: true })
    });
    await controller.startLaunch();
    expect(session.startHosting).not.toHaveBeenCalled();
    expect(sidekickSetup.getSnapshot().dialogOpen).toBe(false);
  });

  it('still auto-hosts the legacy transport', async () => {
    stubWindow('');
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayerTransport: 'rtdb', multiplayerAutoHost: true })
    });
    await controller.startLaunch();
    expect(session.startHosting).toHaveBeenCalled();
  });

  it('routes menu host/join to the sidekick setup, not the RTDB flow', async () => {
    const { prompted } = stubWindow('');
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayerTransport: 'sidekick' })
    });
    await controller.host();
    expect(session.startHosting).not.toHaveBeenCalled();
    expect(sidekickSetup.getSnapshot().dialogOpen).toBe(true);
    sidekickSetup.closeSetup();
    await controller.joinWithPrompt();
    expect(prompted).toEqual([]);
    expect(session.join).not.toHaveBeenCalled();
    expect(sidekickSetup.getSnapshot().dialogOpen).toBe(true);
  });

  it('captures party deep links without network traffic or auto-join', async () => {
    const raw = buildSidekickInvitationPayload({
      endpoint: 'https://sidekick.example.com',
      roomId: ROOM,
      secret: 'invite-secret-7',
      title: 'Friday'
    });
    stubWindow(`#party=${raw}`);
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayerTransport: 'sidekick' })
    });
    await controller.startLaunch();
    expect(session.startHosting).not.toHaveBeenCalled();
    expect(session.join).not.toHaveBeenCalled();
    const snapshot = sidekickSetup.getSnapshot();
    expect(snapshot.dialogOpen).toBe(true);
    expect(snapshot.pendingInvitation).toMatchObject({ roomId: ROOM });
    expect(snapshot.guestStatus).toBe('idle');
    expect(snapshot.guestInfo).toBeNull();
  });

  it('leaves the launch dialog alone for sidekick restores', () => {
    stubWindow('');
    const { controller } = deps({
      multiplayerSettings: settings({ multiplayerTransport: 'sidekick', multiplayerRestoreLastSession: true })
    });
    let open = true;
    const unsubscribe = controller.subscribe((ui) => {
      open = ui.dialog.open;
    });
    controller.prepareLaunchDialog();
    expect(open).toBe(false);
    unsubscribe();
  });
});
