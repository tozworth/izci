/**
 * Server setup controller: service-owned state for server entry, host
 * login, room acquisition, and invitation confirmation. Official builds
 * start with no endpoint and this controller makes no network requests
 * until an explicit user action (Connect, Log in, Create, Join) runs.
 *
 * Login bearers live in memory only. Operator keys may be remembered in a
 * separate device-local store when the user opts in; remembered rooms keep
 * owner/invitation secrets when room remembering or session restore is enabled. All surfaced
 * errors pass through `redactServerSecrets` so invitations never reach
 * UI text, errors, or diagnostics.
 */
import { writable } from 'svelte/store';
import { multiplayerSettings } from '$lib/stores/multiplayer-settings';
import {
  forgetServerInvitation,
  forgetServerServer,
  rememberServerRecent,
  rememberServerServer,
  serverRecents
} from '$lib/stores/multiplayer-server-recents';
import {
  forgetServerHostKey,
  getRememberedServerHostKey,
  rememberServerHostKey
} from '$lib/stores/multiplayer-server-host-keys';
import {
  buildServerInviteLink,
  describeServerEndpoint,
  normalizeServerInviteEndpoint,
  redactServerSecrets,
  type ServerInvitation
} from './multiplayer-server-invite';
import {
  createServerRoom,
  createServerSession,
  deleteServerSession,
  deleteServerRoom,
  fetchDedicatedServerRoom,
  fetchServerInfo,
  recreateServerRoom,
  renewServerRoom,
  resumeServerRoom,
  rotateServerInvitation,
  ServerError,
  type DedicatedServerRoom,
  type ServerRoom,
  type ServerServerInfo,
  type ServerSession
} from './multiplayer-server-http';
import { errorMessage } from './multiplayer-utils';

export const SERVER_SETUP_GUIDE_URL = 'https://github.com/dunsparce9/izci/blob/main/izci-server/README.md';
export const SERVER_PROVIDER_NOTICE_VERSION = 1;

export interface ServerLoginState {
  endpoint: string;
  sessionToken: string;
  expiresAt: string;
}

export interface ServerHostedState {
  endpoint: string;
  roomId: string;
  invitationSecret: string;
  expiresAt: string;
}

export type ServerGuestStatus = 'idle' | 'loading-info' | 'awaiting-providers' | 'connecting' | 'error';

export interface ServerSetupSnapshot {
  dialogOpen: boolean;
  serverInput: string;
  endpoint: string | null;
  endpointDisplay: string | null;
  serverInfo: ServerServerInfo | null;
  infoStatus: 'idle' | 'loading' | 'ready' | 'error';
  infoError: string | null;
  hasLogin: boolean;
  loginEndpoint: string | null;
  hosted: ServerHostedState | null;
  inviteLink: string | null;
  dedicatedInviteLink: string | null;
  pendingInvitation: ServerInvitation | null;
  pendingRemember: boolean;
  hostRemember: boolean;
  rememberHostKey: boolean;
  hasSavedHostKey: boolean;
  guestStatus: ServerGuestStatus;
  guestInfo: ServerServerInfo | null;
  guestError: string | null;
  busy: string | null;
  error: string | null;
}

/** RTC attach points owned by the main-window multiplayer session. */
export interface ServerSessionConnector {
  startHosting(args: {
    endpoint: string;
    hostKey: string;
    sessionToken?: string;
    capacity?: number;
    resume?: { roomId: string; ownerSecret: string };
    signal?: AbortSignal;
  }): Promise<{ endpoint: string; roomId: string; secret: string; ownerSecret: string | null }>;
  joinServer(args: { endpoint: string; roomId: string; secret: string; signal?: AbortSignal }): Promise<void>;
  rotateInvitation(): Promise<string>;
  stopHosting(): Promise<void>;
  leave(): Promise<void>;
}

export interface ServerSetupNetwork {
  fetchInfo(endpoint: string, signal?: AbortSignal): Promise<ServerServerInfo>;
  createSession(endpoint: string, hostKey: string, signal?: AbortSignal): Promise<ServerSession>;
  deleteSession(endpoint: string, sessionToken: string, signal?: AbortSignal): Promise<void>;
  createRoom(endpoint: string, sessionToken: string, capacity: number, signal?: AbortSignal): Promise<ServerRoom>;
  resumeRoom(
    endpoint: string,
    sessionToken: string,
    roomId: string,
    ownerSecret: string,
    signal?: AbortSignal
  ): Promise<{ roomId: string; expiresAt: string }>;
  recreateRoom(
    endpoint: string,
    sessionToken: string,
    saved: { roomId: string; ownerSecret: string; invitationSecret: string },
    capacity: number,
    signal?: AbortSignal
  ): Promise<ServerRoom>;
  renewRoom(
    endpoint: string,
    sessionToken: string,
    roomId: string,
    signal?: AbortSignal
  ): Promise<{ roomId: string; expiresAt: string }>;
  rotateRoom(
    endpoint: string,
    sessionToken: string,
    roomId: string,
    signal?: AbortSignal
  ): Promise<{ roomId: string; invitationSecret: string }>;
  deleteRoom(endpoint: string, sessionToken: string, roomId: string, signal?: AbortSignal): Promise<void>;
  fetchDedicatedRoom?(endpoint: string, sessionToken: string, signal?: AbortSignal): Promise<DedicatedServerRoom>;
}

const DEFAULT_NETWORK: ServerSetupNetwork = {
  fetchInfo: (endpoint, signal) => fetchServerInfo(endpoint, signal),
  createSession: (endpoint, hostKey, signal) => createServerSession(endpoint, hostKey, signal),
  deleteSession: (endpoint, token, signal) => deleteServerSession(endpoint, token, signal),
  createRoom: (endpoint, token, capacity, signal) => createServerRoom(endpoint, token, capacity, signal),
  resumeRoom: (endpoint, token, roomId, ownerSecret, signal) =>
    resumeServerRoom(endpoint, token, roomId, ownerSecret, signal),
  recreateRoom: (endpoint, token, saved, capacity, signal) =>
    recreateServerRoom(endpoint, token, saved, capacity, signal),
  renewRoom: (endpoint, token, roomId, signal) => renewServerRoom(endpoint, token, roomId, signal),
  rotateRoom: (endpoint, token, roomId, signal) => rotateServerInvitation(endpoint, token, roomId, signal),
  deleteRoom: (endpoint, token, roomId, signal) => deleteServerRoom(endpoint, token, roomId, signal),
  fetchDedicatedRoom: (endpoint, token, signal) => fetchDedicatedServerRoom(endpoint, token, signal)
};

function initialSnapshot(): ServerSetupSnapshot {
  return {
    dialogOpen: false,
    serverInput: '',
    endpoint: null,
    endpointDisplay: null,
    serverInfo: null,
    infoStatus: 'idle',
    infoError: null,
    hasLogin: false,
    loginEndpoint: null,
    hosted: null,
    inviteLink: null,
    dedicatedInviteLink: null,
    pendingInvitation: null,
    pendingRemember: false,
    hostRemember: false,
    rememberHostKey: true,
    hasSavedHostKey: false,
    guestStatus: 'idle',
    guestInfo: null,
    guestError: null,
    busy: null,
    error: null
  };
}

function toUserError(error: unknown, fallback: string): string {
  return redactServerSecrets(errorMessage(error, fallback));
}

export function readServerIceAck(): { endpoint: string; urls: string[] } | null {
  try {
    const raw = multiplayerSettings.getSnapshot().multiplayerServerIceAck;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { endpoint?: unknown; urls?: unknown };
    if (typeof parsed.endpoint !== 'string' || !Array.isArray(parsed.urls)) return null;
    if (!parsed.urls.every((url) => typeof url === 'string')) return null;
    return { endpoint: parsed.endpoint, urls: parsed.urls as string[] };
  } catch {
    return null;
  }
}

export function createServerSetupController(
  network: ServerSetupNetwork = DEFAULT_NETWORK
) {
  let state = initialSnapshot();
  let loginState: ServerLoginState | null = null;
  let connector: ServerSessionConnector | null = null;
  let currentAbort: AbortController | null = null;
  const store = writable<ServerSetupSnapshot>(state);
  const listeners = new Set<(snapshot: ServerSetupSnapshot) => void>();

  function publish(): void {
    state = { ...state };
    store.set(state);
    for (const listener of listeners) listener(state);
  }

  function set(patch: Partial<ServerSetupSnapshot>): void {
    state = { ...state, ...patch };
    store.set(state);
    for (const listener of listeners) listener(state);
  }

  function takeSignal(label: string): AbortSignal {
    currentAbort?.abort(new Error('superseded'));
    currentAbort = new AbortController();
    set({ busy: label, error: null });
    return currentAbort.signal;
  }

  function clearBusy(): void {
    currentAbort = null;
    if (state.busy) set({ busy: null });
  }

  function requireConnector(): ServerSessionConnector {
    if (!connector) throw new Error('Open the main window to host or join a server session.');
    return connector;
  }

  async function connectServer(): Promise<void> {
    const signal = takeSignal('connect');
    set({ infoStatus: 'loading', infoError: null, serverInfo: null });
    try {
      const endpoint = normalizeServerInviteEndpoint(state.serverInput);
      const info = await network.fetchInfo(endpoint, signal);
      if (signal.aborted) return;
      const display = describeServerEndpoint(endpoint).authorityWithPrefix;
      rememberServerServer(endpoint, multiplayerSettings.getSnapshot().multiplayerServerLabel);
      multiplayerSettings.update({ multiplayerServerEndpoint: endpoint });
      set({
        endpoint,
        endpointDisplay: display,
        serverInfo: info,
        infoStatus: 'ready',
        hasSavedHostKey: getRememberedServerHostKey(endpoint) !== null
      });
    } catch (error) {
      if (signal.aborted) return;
      set({
        infoStatus: 'error',
        infoError: toUserError(error, 'Could not reach that server. Check the address and try again.')
      });
    } finally {
      clearBusy();
      publish();
    }
  }

  function useSameOrigin(): void {
    if (typeof window === 'undefined') return;
    // Suggest only; the summary still requires an explicit Connect press,
    // and no request is made here.
    set({ serverInput: window.location.origin });
  }

  async function login(hostKey: string): Promise<void> {
    const endpoint = state.endpoint;
    if (!endpoint) throw new Error('Connect to a server first.');
    const enteredKey = hostKey.trim();
    const savedKey = getRememberedServerHostKey(endpoint);
    const key = enteredKey || savedKey;
    if (!key) throw new Error('Enter the operator key first.');
    const signal = takeSignal('login');
    try {
      const session = await network.createSession(endpoint, key, signal);
      if (signal.aborted) return;
      if (state.rememberHostKey) {
        rememberServerHostKey(endpoint, key);
      } else {
        forgetServerHostKey(endpoint);
      }
      loginState = { endpoint, sessionToken: session.sessionToken, expiresAt: session.expiresAt };
      let dedicatedInviteLink: string | null = null;
      try {
        const dedicated = await network.fetchDedicatedRoom?.(endpoint, session.sessionToken, signal);
        if (!dedicated) throw new ServerError('room-unavailable', 404);
        dedicatedInviteLink = buildServerInviteLink({
          endpoint,
          roomId: dedicated.roomId,
          secret: dedicated.invitationSecret,
          title: multiplayerSettings.getSnapshot().multiplayerServerLabel || null
        }, typeof window !== 'undefined' ? window.location.origin : '');
      } catch {
        if (signal.aborted) return;
        // Dedicated-room discovery is additive. A signaling-only server (or
        // an older deployment) must still allow this browser to host a room.
      }
      set({
        hasLogin: true,
        loginEndpoint: endpoint,
        dedicatedInviteLink,
        hasSavedHostKey: getRememberedServerHostKey(endpoint) !== null
      });
    } catch (error) {
      if (signal.aborted) return;
      if (!enteredKey && savedKey && error instanceof ServerError && error.code === 'unauthorized') {
        forgetServerHostKey(endpoint);
        set({ hasSavedHostKey: false });
      }
      set({ error: toUserError(error, 'Login failed. Check the operator key and try again.') });
      publish();
      throw error instanceof Error ? error : new Error('Login failed.');
    } finally {
      clearBusy();
      publish();
    }
  }

  async function logout(): Promise<void> {
    const signal = takeSignal('logout');
    try {
      if (state.hosted) {
        await requireConnector().stopHosting().catch(() => undefined);
      } else if (loginState) {
        await network.deleteSession(loginState.endpoint, loginState.sessionToken, signal).catch(() => undefined);
      }
    } finally {
      loginState = null;
      set({ hasLogin: false, loginEndpoint: null, hosted: null, inviteLink: null, dedicatedInviteLink: null });
      clearBusy();
      publish();
    }
  }

  async function createRoom(): Promise<void> {
    const session = requireConnector();
    if (!loginState || !state.endpoint) throw new Error('Log in to the server first.');
    const signal = takeSignal('create-room');
    try {
      const capacity = multiplayerSettings.getSnapshot().multiplayerMaxListeners;
      const invitation = await session.startHosting({
        endpoint: state.endpoint,
        hostKey: '',
        sessionToken: loginState.sessionToken,
        capacity,
        signal
      });
      if (signal.aborted) return;
      // Ownership of the bearer moves to the multiplayer session, which
      // closes the room and revokes it on stop. Drop our reference.
      loginState = null;
      const link = buildServerInviteLink(
        {
          endpoint: invitation.endpoint,
          roomId: invitation.roomId,
          secret: invitation.secret,
          title: multiplayerSettings.getSnapshot().multiplayerServerLabel || null
        },
        typeof window !== 'undefined' ? window.location.origin : ''
      );
      set({
        hasLogin: false,
        loginEndpoint: null,
        hosted: {
          endpoint: invitation.endpoint,
          roomId: invitation.roomId,
          invitationSecret: invitation.secret,
          expiresAt: ''
        },
        inviteLink: link
      });
      rememberServerRecent({
        endpoint: invitation.endpoint,
        roomId: invitation.roomId,
        displayName: multiplayerSettings.getSnapshot().multiplayerServerLabel || invitation.roomId.slice(0, 8),
        invitationSecret: invitation.secret,
        ownerSecret: invitation.ownerSecret
      }, { rememberInvitation: state.hostRemember });
    } catch (error) {
      if (signal.aborted) return;
      const message = toUserError(error, 'Could not create a room on that server.');
      // An expired bearer needs a fresh login, not a retry.
      if (message === 'unauthorized') {
        loginState = null;
        set({
          hasLogin: false,
          loginEndpoint: null,
          error: 'That login expired. Enter the operator key again.'
        });
      } else {
        set({ error: message });
      }
      publish();
      throw error instanceof Error ? error : new Error(message);
    } finally {
      clearBusy();
      publish();
    }
  }

  async function hostConfigured(): Promise<void> {
    const settings = multiplayerSettings.getSnapshot();
    if (!settings.multiplayerServerEndpoint) {
      throw new Error('Set up a Server server in Options > Multiplayer first.');
    }
    set({ serverInput: settings.multiplayerServerEndpoint, hostRemember: true });
    await connectServer();
    if (state.infoStatus !== 'ready' || !state.endpoint) {
      throw new Error(state.infoError || 'Could not reach the configured Server server.');
    }
    if (!getRememberedServerHostKey(state.endpoint)) {
      throw new Error('Save the Server operator key in Options > Multiplayer first.');
    }
    await login('');
    await createRoom();
  }

  async function resumeRoom(roomId: string, ownerSecret: string): Promise<void> {
    const session = requireConnector();
    if (!loginState || !state.endpoint) throw new Error('Log in to the server first.');
    const signal = takeSignal('resume-room');
    try {
      const invitation = await session.startHosting({
        endpoint: state.endpoint,
        hostKey: '',
        sessionToken: loginState.sessionToken,
        resume: { roomId, ownerSecret },
        signal
      });
      if (signal.aborted) return;
      loginState = null;
      // Resume keeps the original invitation; reuse the remembered secret
      // when we still hold it, otherwise the session owns the room.
      const secret = invitation.secret || ownerSecret;
      if (state.hostRemember) {
        const previous = serverRecents.getSnapshot().find(
          (entry) => entry.endpoint === invitation.endpoint && entry.roomId === invitation.roomId
        );
        rememberServerRecent({
          endpoint: invitation.endpoint,
          roomId: invitation.roomId,
          displayName: multiplayerSettings.getSnapshot().multiplayerServerLabel || invitation.roomId.slice(0, 8),
          invitationSecret: invitation.secret || previous?.invitationSecret || null,
          ownerSecret: invitation.ownerSecret || ownerSecret
        }, { rememberInvitation: true });
      }
      set({
        hasLogin: false,
        loginEndpoint: null,
        hosted: {
          endpoint: invitation.endpoint,
          roomId: invitation.roomId,
          invitationSecret: secret,
          expiresAt: ''
        },
        inviteLink: invitation.secret
          ? buildServerInviteLink(
            {
              endpoint: invitation.endpoint,
              roomId: invitation.roomId,
              secret: invitation.secret,
              title: multiplayerSettings.getSnapshot().multiplayerServerLabel || null
            },
            typeof window !== 'undefined' ? window.location.origin : ''
          )
          : null
      });
    } catch (error) {
      if (signal.aborted) return;
      set({ error: toUserError(error, 'Could not resume that room. It may be gone after a server restart.') });
      publish();
      throw error instanceof Error ? error : new Error('Could not resume that room.');
    } finally {
      clearBusy();
      publish();
    }
  }

  /**
   * Resume a remembered room; when the server restarted and the room is
   * absent, recreate the same room ID and invitation atomically with host
   * authentication. A live room owned elsewhere still refuses the
   * collision unless the owner secret matches.
   */
  async function resumeOrRecreateRoom(roomId: string, ownerSecret: string): Promise<void> {
    const session = requireConnector();
    if (!loginState || !state.endpoint) throw new Error('Log in to the server first.');
    const recent = serverRecents.getSnapshot().find(
      (entry) => entry.endpoint === state.endpoint && entry.roomId === roomId
    );
    const invitationSecret = recent?.invitationSecret;
    const signal = takeSignal('resume-room');
    const capacity = multiplayerSettings.getSnapshot().multiplayerMaxListeners;
    const hostRoom = async (resume: { roomId: string; ownerSecret: string }) =>
      session.startHosting({
        endpoint: state.endpoint!,
        hostKey: '',
        sessionToken: loginState!.sessionToken,
        resume,
        signal
      });
    try {
      try {
        await hostRoom({ roomId, ownerSecret });
      } catch (error) {
        const gone = error instanceof ServerError
          && (error.code === 'room-unavailable' || error.code === 'not-found');
        if (!gone || !invitationSecret) throw error;
        // The room lapsed (restart or lease expiry): rebuild it with the
        // saved IDs so existing invite links keep working.
        await network.recreateRoom(
          state.endpoint,
          loginState.sessionToken,
          { roomId, ownerSecret, invitationSecret },
          capacity,
          signal
        );
        if (signal.aborted) return;
        await hostRoom({ roomId, ownerSecret });
      }
      if (signal.aborted) return;
      loginState = null;
      const link = invitationSecret
        ? buildServerInviteLink(
          {
            endpoint: state.endpoint,
            roomId,
            secret: invitationSecret,
            title: multiplayerSettings.getSnapshot().multiplayerServerLabel || null
          },
          typeof window !== 'undefined' ? window.location.origin : ''
        )
        : null;
      set({
        hasLogin: false,
        loginEndpoint: null,
        hosted: { endpoint: state.endpoint, roomId, invitationSecret: invitationSecret ?? ownerSecret, expiresAt: '' },
        inviteLink: link
      });
    } catch (error) {
      if (signal.aborted) return;
      set({ error: toUserError(error, 'Could not resume that room. It may be gone after a server restart.') });
      publish();
      throw error instanceof Error ? error : new Error('Could not resume that room.');
    } finally {
      clearBusy();
      publish();
    }
  }

  async function rotateInvitation(): Promise<void> {
    const session = requireConnector();
    if (!state.hosted) throw new Error('No hosted room to rotate.');
    const signal = takeSignal('rotate');
    try {
      const secret = await session.rotateInvitation();
      if (signal.aborted) return;
      const hosted = { ...state.hosted, invitationSecret: secret };
      set({
        hosted,
        inviteLink: buildServerInviteLink(
          {
            endpoint: hosted.endpoint,
            roomId: hosted.roomId,
            secret,
            title: multiplayerSettings.getSnapshot().multiplayerServerLabel || null
          },
          typeof window !== 'undefined' ? window.location.origin : ''
        )
      });
    } catch (error) {
      if (signal.aborted) return;
      set({ error: toUserError(error, 'Could not rotate that invitation.') });
      publish();
      throw error instanceof Error ? error : new Error('Could not rotate that invitation.');
    } finally {
      clearBusy();
      publish();
    }
  }

  async function closeRoom(): Promise<void> {
    const session = requireConnector();
    const signal = takeSignal('close-room');
    try {
      await session.stopHosting();
      if (signal.aborted) return;
      set({ hosted: null, inviteLink: null });
    } finally {
      clearBusy();
      publish();
    }
  }

  function captureInvitation(invitation: ServerInvitation, openDialog = true): void {
    currentAbort?.abort(new Error('superseded'));
    currentAbort = null;
    set({
      dialogOpen: openDialog,
      pendingInvitation: invitation,
      pendingRemember: multiplayerSettings.getSnapshot().multiplayerRestoreLastSession,
      guestStatus: 'idle',
      guestInfo: null,
      guestError: null,
      busy: null,
      error: null
    });
  }

  function dismissPending(): void {
    currentAbort?.abort(new Error('dismissed'));
    currentAbort = null;
    set({
      pendingInvitation: null,
      pendingRemember: false,
      guestStatus: 'idle',
      guestInfo: null,
      guestError: null,
      busy: null
    });
  }

  async function joinPending(): Promise<void> {
    const invitation = state.pendingInvitation;
    if (!invitation) throw new Error('No invitation to join.');
    const signal = takeSignal('join');
    set({ guestStatus: 'loading-info', guestError: null, guestInfo: null });
    try {
      // Server info is fetched only after Join, never while capturing the
      // invitation or restoring state.
      const info = await network.fetchInfo(invitation.endpoint, signal);
      if (signal.aborted) return;
      // ICE configuration is owned and authenticated by the Server. The
      // client fetches it again for the admitted room; it is not a separate
      // user setup step.
      await connectGuestWithSignal(signal);
    } catch (error) {
      if (signal.aborted) return;
      set({ guestStatus: 'error', guestError: toUserError(error, 'Could not reach that server.') });
    } finally {
      clearBusy();
      publish();
    }
  }

  async function joinInvitation(invitation: ServerInvitation): Promise<void> {
    captureInvitation(invitation, false);
    await joinPending();
    if (state.guestStatus === 'error') {
      set({ dialogOpen: true });
    }
  }

  async function connectGuestWithSignal(signal: AbortSignal): Promise<void> {
    const invitation = state.pendingInvitation;
    if (!invitation) throw new Error('No invitation to join.');
    set({ guestStatus: 'connecting', guestError: null });
    publish();
    try {
      await requireConnector().joinServer({
        endpoint: invitation.endpoint,
        roomId: invitation.roomId,
        secret: invitation.secret,
        signal
      });
      if (signal.aborted) return;
      rememberServerServer(invitation.endpoint, invitation.title ?? '');
      rememberServerRecent({
        endpoint: invitation.endpoint,
        roomId: invitation.roomId,
        displayName: invitation.title || invitation.roomId.slice(0, 8),
        invitationSecret: invitation.secret,
        ownerSecret: null
      }, { rememberInvitation: state.pendingRemember });
      set({
        dialogOpen: false,
        pendingInvitation: null,
        pendingRemember: false,
        guestStatus: 'idle',
        guestInfo: null
      });
    } catch (error) {
      if (signal.aborted) {
        set({ guestStatus: 'idle' });
        return;
      }
      set({ guestStatus: 'error', guestError: toUserError(error, 'Could not join that party.') });
      throw error instanceof Error ? error : new Error('Could not join that party.');
    } finally {
      publish();
    }
  }

  async function acknowledgeProvidersAndConnect(): Promise<void> {
    const info = state.guestInfo;
    const invitation = state.pendingInvitation;
    if (!info || !invitation) throw new Error('No server details to acknowledge.');
    multiplayerSettings.update({
      multiplayerServerIceAck: JSON.stringify({ endpoint: invitation.endpoint, urls: info.iceUrls }).slice(0, 2048)
    });
    const signal = currentAbort?.signal ?? takeSignal('join');
    try {
      await connectGuestWithSignal(signal);
    } finally {
      clearBusy();
      publish();
    }
  }

  function cancelCurrent(): void {
    currentAbort?.abort(new Error('cancelled'));
    currentAbort = null;
    if (state.guestStatus === 'connecting') {
      connector?.leave().catch(() => undefined);
      set({ guestStatus: 'idle', busy: null });
    } else {
      set({ busy: null });
      if (state.guestStatus === 'loading-info') set({ guestStatus: 'idle' });
    }
    publish();
  }

  function acknowledgeNotice(): void {
    multiplayerSettings.update({ multiplayerServerNoticeVersion: SERVER_PROVIDER_NOTICE_VERSION });
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => ({ ...state }),
    /** In-memory login bearer for tests; never persisted. */
    getLoginTokenForTest: () => loginState?.sessionToken ?? null,
    setSessionConnector(next: ServerSessionConnector | null): void {
      connector = next;
    },
    openSetup(): void {
      set({ dialogOpen: true });
    },
    closeSetup(): void {
      currentAbort?.abort(new Error('dismissed'));
      currentAbort = null;
      set({ dialogOpen: false, busy: null });
      if (state.guestStatus === 'connecting') {
        connector?.leave().catch(() => undefined);
        set({ guestStatus: 'idle' });
      }
      publish();
    },
    setServerInput(value: string): void {
      set({ serverInput: value });
    },
    setHostRemember(value: boolean): void {
      set({ hostRemember: value });
    },
    setRememberHostKey(value: boolean): void {
      if (!value && state.endpoint) forgetServerHostKey(state.endpoint);
      set({
        rememberHostKey: value,
        hasSavedHostKey: value && state.endpoint
          ? getRememberedServerHostKey(state.endpoint) !== null
          : false
      });
    },
    setPendingRemember(value: boolean): void {
      set({ pendingRemember: value });
    },
    connectServer,
    useSameOrigin,
    login,
    logout,
    createRoom,
    hostConfigured,
    resumeRoom,
    resumeOrRecreateRoom,
    rotateInvitation,
    closeRoom,
    captureInvitation,
    dismissPending,
    joinPending,
    joinInvitation,
    acknowledgeProvidersAndConnect,
    cancelCurrent,
    acknowledgeNotice,
    forgetServer(endpoint: string): void {
      forgetServerHostKey(endpoint);
      forgetServerServer(endpoint);
      if (state.endpoint === endpoint) set({ hasSavedHostKey: false });
    },
    forgetInvitation(endpoint: string, roomId: string): void {
      forgetServerInvitation(endpoint, roomId);
    }
  };
}

export type ServerSetupController = ReturnType<typeof createServerSetupController>;

/** Shared controller for the main window; Options configures stores only. */
export const serverSetup = createServerSetupController();
