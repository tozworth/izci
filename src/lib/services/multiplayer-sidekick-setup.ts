/**
 * Sidekick setup controller: service-owned state for server entry, host
 * login, room acquisition, and invitation confirmation. Official builds
 * start with no endpoint and this controller makes no network requests
 * until an explicit user action (Connect, Log in, Create, Join) runs.
 *
 * Login bearers live in memory only. Operator keys may be remembered in a
 * separate device-local store when the user opts in; remembered rooms keep
 * owner/invitation secrets only when Remember was chosen. All surfaced
 * errors pass through `redactSidekickSecrets` so invitations never reach
 * UI text, errors, or diagnostics.
 */
import { writable } from 'svelte/store';
import { multiplayerSettings } from '$lib/stores/multiplayer-settings';
import {
  forgetSidekickInvitation,
  forgetSidekickServer,
  rememberSidekickRecent,
  rememberSidekickServer,
  sidekickRecents
} from '$lib/stores/multiplayer-sidekick-recents';
import {
  forgetSidekickHostKey,
  getRememberedSidekickHostKey,
  rememberSidekickHostKey
} from '$lib/stores/multiplayer-sidekick-host-keys';
import {
  buildSidekickInviteLink,
  describeSidekickEndpoint,
  normalizeSidekickInviteEndpoint,
  redactSidekickSecrets,
  type SidekickInvitation
} from './multiplayer-sidekick-invite';
import {
  createSidekickRoom,
  createSidekickSession,
  deleteSidekickSession,
  deleteSidekickRoom,
  fetchSidekickInfo,
  recreateSidekickRoom,
  renewSidekickRoom,
  resumeSidekickRoom,
  rotateSidekickInvitation,
  SidekickError,
  type SidekickRoom,
  type SidekickServerInfo,
  type SidekickSession
} from './multiplayer-sidekick-http';
import { errorMessage } from './multiplayer-utils';

export const SIDEKICK_SETUP_GUIDE_URL = 'https://github.com/dunsparce9/izci/blob/main/sidekick/README.md';
export const SIDEKICK_PROVIDER_NOTICE_VERSION = 1;

export interface SidekickLoginState {
  endpoint: string;
  sessionToken: string;
  expiresAt: string;
}

export interface SidekickHostedState {
  endpoint: string;
  roomId: string;
  invitationSecret: string;
  expiresAt: string;
}

export type SidekickGuestStatus = 'idle' | 'loading-info' | 'awaiting-providers' | 'connecting' | 'error';

export interface SidekickSetupSnapshot {
  dialogOpen: boolean;
  serverInput: string;
  endpoint: string | null;
  endpointDisplay: string | null;
  serverInfo: SidekickServerInfo | null;
  infoStatus: 'idle' | 'loading' | 'ready' | 'error';
  infoError: string | null;
  hasLogin: boolean;
  loginEndpoint: string | null;
  hosted: SidekickHostedState | null;
  inviteLink: string | null;
  pendingInvitation: SidekickInvitation | null;
  pendingRemember: boolean;
  hostRemember: boolean;
  rememberHostKey: boolean;
  hasSavedHostKey: boolean;
  guestStatus: SidekickGuestStatus;
  guestInfo: SidekickServerInfo | null;
  guestError: string | null;
  busy: string | null;
  error: string | null;
}

/** RTC attach points owned by the main-window multiplayer session. */
export interface SidekickSessionConnector {
  startHosting(args: {
    endpoint: string;
    hostKey: string;
    sessionToken?: string;
    capacity?: number;
    resume?: { roomId: string; ownerSecret: string };
    signal?: AbortSignal;
  }): Promise<{ endpoint: string; roomId: string; secret: string; ownerSecret: string | null }>;
  joinSidekick(args: { endpoint: string; roomId: string; secret: string; signal?: AbortSignal }): Promise<void>;
  rotateInvitation(): Promise<string>;
  stopHosting(): Promise<void>;
  leave(): Promise<void>;
}

export interface SidekickSetupNetwork {
  fetchInfo(endpoint: string, signal?: AbortSignal): Promise<SidekickServerInfo>;
  createSession(endpoint: string, hostKey: string, signal?: AbortSignal): Promise<SidekickSession>;
  deleteSession(endpoint: string, sessionToken: string, signal?: AbortSignal): Promise<void>;
  createRoom(endpoint: string, sessionToken: string, capacity: number, signal?: AbortSignal): Promise<SidekickRoom>;
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
  ): Promise<SidekickRoom>;
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
}

const DEFAULT_NETWORK: SidekickSetupNetwork = {
  fetchInfo: (endpoint, signal) => fetchSidekickInfo(endpoint, signal),
  createSession: (endpoint, hostKey, signal) => createSidekickSession(endpoint, hostKey, signal),
  deleteSession: (endpoint, token, signal) => deleteSidekickSession(endpoint, token, signal),
  createRoom: (endpoint, token, capacity, signal) => createSidekickRoom(endpoint, token, capacity, signal),
  resumeRoom: (endpoint, token, roomId, ownerSecret, signal) =>
    resumeSidekickRoom(endpoint, token, roomId, ownerSecret, signal),
  recreateRoom: (endpoint, token, saved, capacity, signal) =>
    recreateSidekickRoom(endpoint, token, saved, capacity, signal),
  renewRoom: (endpoint, token, roomId, signal) => renewSidekickRoom(endpoint, token, roomId, signal),
  rotateRoom: (endpoint, token, roomId, signal) => rotateSidekickInvitation(endpoint, token, roomId, signal),
  deleteRoom: (endpoint, token, roomId, signal) => deleteSidekickRoom(endpoint, token, roomId, signal)
};

function initialSnapshot(): SidekickSetupSnapshot {
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
  return redactSidekickSecrets(errorMessage(error, fallback));
}

export function readSidekickIceAck(): { endpoint: string; urls: string[] } | null {
  try {
    const raw = multiplayerSettings.getSnapshot().multiplayerSidekickIceAck;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { endpoint?: unknown; urls?: unknown };
    if (typeof parsed.endpoint !== 'string' || !Array.isArray(parsed.urls)) return null;
    if (!parsed.urls.every((url) => typeof url === 'string')) return null;
    return { endpoint: parsed.endpoint, urls: parsed.urls as string[] };
  } catch {
    return null;
  }
}

export function createSidekickSetupController(
  network: SidekickSetupNetwork = DEFAULT_NETWORK
) {
  let state = initialSnapshot();
  let loginState: SidekickLoginState | null = null;
  let connector: SidekickSessionConnector | null = null;
  let currentAbort: AbortController | null = null;
  const store = writable<SidekickSetupSnapshot>(state);
  const listeners = new Set<(snapshot: SidekickSetupSnapshot) => void>();

  function publish(): void {
    state = { ...state };
    store.set(state);
    for (const listener of listeners) listener(state);
  }

  function set(patch: Partial<SidekickSetupSnapshot>): void {
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

  function requireConnector(): SidekickSessionConnector {
    if (!connector) throw new Error('Open the main window to host or join a sidekick session.');
    return connector;
  }

  async function connectServer(): Promise<void> {
    const signal = takeSignal('connect');
    set({ infoStatus: 'loading', infoError: null, serverInfo: null });
    try {
      const endpoint = normalizeSidekickInviteEndpoint(state.serverInput);
      const info = await network.fetchInfo(endpoint, signal);
      if (signal.aborted) return;
      const display = describeSidekickEndpoint(endpoint).authorityWithPrefix;
      rememberSidekickServer(endpoint, multiplayerSettings.getSnapshot().multiplayerSidekickLabel);
      multiplayerSettings.update({ multiplayerSidekickEndpoint: endpoint });
      set({
        endpoint,
        endpointDisplay: display,
        serverInfo: info,
        infoStatus: 'ready',
        hasSavedHostKey: getRememberedSidekickHostKey(endpoint) !== null
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
    const savedKey = getRememberedSidekickHostKey(endpoint);
    const key = enteredKey || savedKey;
    if (!key) throw new Error('Enter the operator key first.');
    const signal = takeSignal('login');
    try {
      const session = await network.createSession(endpoint, key, signal);
      if (signal.aborted) return;
      if (state.rememberHostKey) {
        rememberSidekickHostKey(endpoint, key);
      } else {
        forgetSidekickHostKey(endpoint);
      }
      loginState = { endpoint, sessionToken: session.sessionToken, expiresAt: session.expiresAt };
      set({
        hasLogin: true,
        loginEndpoint: endpoint,
        hasSavedHostKey: getRememberedSidekickHostKey(endpoint) !== null
      });
    } catch (error) {
      if (signal.aborted) return;
      if (!enteredKey && savedKey && error instanceof SidekickError && error.code === 'unauthorized') {
        forgetSidekickHostKey(endpoint);
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
      set({ hasLogin: false, loginEndpoint: null, hosted: null, inviteLink: null });
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
      const link = buildSidekickInviteLink(
        {
          endpoint: invitation.endpoint,
          roomId: invitation.roomId,
          secret: invitation.secret,
          title: multiplayerSettings.getSnapshot().multiplayerSidekickLabel || null
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
      rememberSidekickRecent({
        endpoint: invitation.endpoint,
        roomId: invitation.roomId,
        displayName: multiplayerSettings.getSnapshot().multiplayerSidekickLabel || invitation.roomId.slice(0, 8),
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
    if (!settings.multiplayerSidekickEndpoint) {
      throw new Error('Set up a Sidekick server in Options > Multiplayer first.');
    }
    set({ serverInput: settings.multiplayerSidekickEndpoint, hostRemember: true });
    await connectServer();
    if (state.infoStatus !== 'ready' || !state.endpoint) {
      throw new Error(state.infoError || 'Could not reach the configured Sidekick server.');
    }
    if (!getRememberedSidekickHostKey(state.endpoint)) {
      throw new Error('Save the Sidekick operator key in Options > Multiplayer first.');
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
        const previous = sidekickRecents.getSnapshot().find(
          (entry) => entry.endpoint === invitation.endpoint && entry.roomId === invitation.roomId
        );
        rememberSidekickRecent({
          endpoint: invitation.endpoint,
          roomId: invitation.roomId,
          displayName: multiplayerSettings.getSnapshot().multiplayerSidekickLabel || invitation.roomId.slice(0, 8),
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
          ? buildSidekickInviteLink(
            {
              endpoint: invitation.endpoint,
              roomId: invitation.roomId,
              secret: invitation.secret,
              title: multiplayerSettings.getSnapshot().multiplayerSidekickLabel || null
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
    const recent = sidekickRecents.getSnapshot().find(
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
        const gone = error instanceof SidekickError
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
        ? buildSidekickInviteLink(
          {
            endpoint: state.endpoint,
            roomId,
            secret: invitationSecret,
            title: multiplayerSettings.getSnapshot().multiplayerSidekickLabel || null
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
        inviteLink: buildSidekickInviteLink(
          {
            endpoint: hosted.endpoint,
            roomId: hosted.roomId,
            secret,
            title: multiplayerSettings.getSnapshot().multiplayerSidekickLabel || null
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

  function captureInvitation(invitation: SidekickInvitation, openDialog = true): void {
    currentAbort?.abort(new Error('superseded'));
    currentAbort = null;
    set({
      dialogOpen: openDialog,
      pendingInvitation: invitation,
      pendingRemember: false,
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
      // ICE configuration is owned and authenticated by the Sidekick. The
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

  async function joinInvitation(invitation: SidekickInvitation): Promise<void> {
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
      await requireConnector().joinSidekick({
        endpoint: invitation.endpoint,
        roomId: invitation.roomId,
        secret: invitation.secret,
        signal
      });
      if (signal.aborted) return;
      rememberSidekickServer(invitation.endpoint, invitation.title ?? '');
      rememberSidekickRecent({
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
      multiplayerSidekickIceAck: JSON.stringify({ endpoint: invitation.endpoint, urls: info.iceUrls }).slice(0, 2048)
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
    multiplayerSettings.update({ multiplayerSidekickNoticeVersion: SIDEKICK_PROVIDER_NOTICE_VERSION });
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => ({ ...state }),
    /** In-memory login bearer for tests; never persisted. */
    getLoginTokenForTest: () => loginState?.sessionToken ?? null,
    setSessionConnector(next: SidekickSessionConnector | null): void {
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
      if (!value && state.endpoint) forgetSidekickHostKey(state.endpoint);
      set({
        rememberHostKey: value,
        hasSavedHostKey: value && state.endpoint
          ? getRememberedSidekickHostKey(state.endpoint) !== null
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
      forgetSidekickHostKey(endpoint);
      forgetSidekickServer(endpoint);
      if (state.endpoint === endpoint) set({ hasSavedHostKey: false });
    },
    forgetInvitation(endpoint: string, roomId: string): void {
      forgetSidekickInvitation(endpoint, roomId);
    }
  };
}

export type SidekickSetupController = ReturnType<typeof createSidekickSetupController>;

/** Shared controller for the main window; Options configures stores only. */
export const sidekickSetup = createSidekickSetupController();
