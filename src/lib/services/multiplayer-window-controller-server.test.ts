import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMultiplayerWindowController } from './multiplayer-window-controller';
import { serverSetup } from './multiplayer-server-setup';
import { buildServerInvitationPayload } from './multiplayer-server-invite';
import type { MultiplayerSettings } from '$lib/types';

const ROOM = 'd'.repeat(32);

function settings(overrides: Partial<MultiplayerSettings> = {}): MultiplayerSettings {
  return {
    multiplayer: true,
    izciName: 'Test',
    multiplayerTransport: 'rtdb',
    multiplayerServerEndpoint: '',
    multiplayerServerLabel: '',
    multiplayerServerNoticeVersion: 1,
    multiplayerServerAutoReconnect: false,
    multiplayerServerForceRelay: false,
    multiplayerServerIceAck: '',
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
    getSnapshot: vi.fn(() => ({ mode: 'idle' })),
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
      playCollectionItemsNext: () => false,
      editSharedQueue: () => false,
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
  vi.restoreAllMocks();
  serverSetup.dismissPending();
  serverSetup.closeSetup();
  delete (globalThis as Record<string, unknown>)['window'];
});

function stubWindow(hash: string, promptAnswer: string | null = null): { prompted: string[]; fire: (event: string) => void } {
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
      return promptAnswer;
    },
    addEventListener: (event: string, listener: () => void) => {
      listeners[event] = listener;
    },
    clearTimeout: (id: number) => clearTimeout(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms)
  };
  return { prompted, fire: (event: string) => listeners[event]?.() };
}

describe('multiplayer window controller server routing', () => {
  it('keeps server auto-host silent on launch', async () => {
    stubWindow('');
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayerTransport: 'server', multiplayerAutoHost: true })
    });
    await controller.startLaunch();
    expect(session.startHosting).not.toHaveBeenCalled();
    expect(serverSetup.getSnapshot().dialogOpen).toBe(false);
  });

  it('still auto-hosts the legacy transport', async () => {
    stubWindow('');
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayerTransport: 'rtdb', multiplayerAutoHost: true })
    });
    await controller.startLaunch();
    expect(session.startHosting).toHaveBeenCalled();
  });

  it('runs server commands directly instead of opening the setup surface', async () => {
    const raw = buildServerInvitationPayload({
      endpoint: 'https://server.example.com',
      roomId: ROOM,
      secret: 'invite-secret-7',
      title: null
    });
    const { prompted } = stubWindow('', `https://izci.example/#party=${raw}`);
    const hostConfigured = vi.spyOn(serverSetup, 'hostConfigured').mockResolvedValueOnce();
    const joinInvitation = vi.spyOn(serverSetup, 'joinInvitation').mockResolvedValueOnce();
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayerTransport: 'server' })
    });
    await controller.host();
    expect(hostConfigured).toHaveBeenCalledOnce();
    expect(session.startHosting).not.toHaveBeenCalled();
    expect(serverSetup.getSnapshot().dialogOpen).toBe(false);
    await controller.joinWithPrompt();
    expect(prompted).toEqual(['main.multiplayer.server.enterInvite']);
    expect(session.join).not.toHaveBeenCalled();
    expect(joinInvitation).toHaveBeenCalledWith(expect.objectContaining({ roomId: ROOM }));
    expect(serverSetup.getSnapshot().dialogOpen).toBe(false);
  });

  it('captures party deep links without network traffic or auto-join', async () => {
    const raw = buildServerInvitationPayload({
      endpoint: 'https://server.example.com',
      roomId: ROOM,
      secret: 'invite-secret-7',
      title: 'Friday'
    });
    stubWindow(`#party=${raw}`);
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayerTransport: 'server' })
    });
    await controller.startLaunch();
    expect(session.startHosting).not.toHaveBeenCalled();
    expect(session.join).not.toHaveBeenCalled();
    const snapshot = serverSetup.getSnapshot();
    expect(snapshot.dialogOpen).toBe(true);
    expect(snapshot.pendingInvitation).toMatchObject({ roomId: ROOM });
    expect(snapshot.guestStatus).toBe('idle');
    expect(snapshot.guestInfo).toBeNull();
  });

  it('captures party deep links for fresh clients with multiplayer disabled', async () => {
    const raw = buildServerInvitationPayload({
      endpoint: 'https://server.example.com',
      roomId: ROOM,
      secret: 'invite-secret-7',
      title: 'Friday'
    });
    stubWindow(`#party=${raw}`);
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayer: false, multiplayerTransport: 'server' })
    });
    await controller.startLaunch();
    expect(session.startHosting).not.toHaveBeenCalled();
    expect(session.join).not.toHaveBeenCalled();
    const snapshot = serverSetup.getSnapshot();
    expect(snapshot.dialogOpen).toBe(true);
    expect(snapshot.pendingInvitation).toMatchObject({ roomId: ROOM });
    expect(snapshot.guestStatus).toBe('idle');
  });

  it('leaves legacy invite codes alone for fresh clients with multiplayer disabled', async () => {
    const stub = stubWindow('#join=abcd1234');
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayer: false, multiplayerTransport: 'rtdb' })
    });
    await controller.startLaunch();
    expect(session.join).not.toHaveBeenCalled();
    expect(session.startHosting).not.toHaveBeenCalled();
    expect(serverSetup.getSnapshot().dialogOpen).toBe(false);
    expect(
      ((globalThis as Record<string, unknown>)['window'] as { location: { hash: string } }).location.hash
    ).toBe('#join=abcd1234');
    stub.fire('hashchange');
    expect(session.join).not.toHaveBeenCalled();
  });

  it('picks up party deep links arriving after launch while multiplayer is disabled', async () => {
    const raw = buildServerInvitationPayload({
      endpoint: 'https://server.example.com',
      roomId: ROOM,
      secret: 'invite-secret-7',
      title: null
    });
    const stub = stubWindow('');
    const { session, controller } = deps({
      multiplayerSettings: settings({ multiplayer: false, multiplayerTransport: 'server' })
    });
    await controller.startLaunch();
    expect(serverSetup.getSnapshot().dialogOpen).toBe(false);
    ((globalThis as Record<string, unknown>)['window'] as { location: { hash: string } }).location.hash = `#party=${raw}`;
    stub.fire('hashchange');
    expect(session.join).not.toHaveBeenCalled();
    expect(serverSetup.getSnapshot().dialogOpen).toBe(true);
    expect(serverSetup.getSnapshot().pendingInvitation).toMatchObject({ roomId: ROOM });
  });

  it('leaves the launch dialog alone for server restores', () => {
    stubWindow('');
    const { controller } = deps({
      multiplayerSettings: settings({ multiplayerTransport: 'server', multiplayerRestoreLastSession: true })
    });
    let open = true;
    const unsubscribe = controller.subscribe((ui) => {
      open = ui.dialog.open;
    });
    controller.prepareLaunchDialog();
    expect(open).toBe(false);
    unsubscribe();
  });

  it('finishes joining an idle host without waiting for an audio generation', async () => {
    stubWindow('');
    const { controller } = deps();
    let open = false;
    const unsubscribe = controller.subscribe((ui) => {
      open = ui.dialog.open;
    });

    await controller.join('abcd1234');
    expect(open).toBe(true);
    controller.syncFromSession({
      mode: 'client',
      connectionStatus: 'connected',
      message: null,
      reconnecting: false,
      freeplay: false,
      receiveAudio: true,
      audioStatus: 'connecting',
      remoteCatalog: { queue: [], library: [], favorites: [], revision: 0 },
      remoteDelivery: { mode: 'none', generationId: 'idle' }
    } as never);

    expect(open).toBe(false);
    unsubscribe();
  });
});
