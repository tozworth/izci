import { beforeEach, describe, expect, it } from 'vitest';
import {
  createServerSetupController,
  SERVER_PROVIDER_NOTICE_VERSION,
  type ServerSetupNetwork,
  type ServerSessionConnector
} from './multiplayer-server-setup';
import { multiplayerSettings } from '$lib/stores/multiplayer-settings';
import { serverRecents, serverServers } from '$lib/stores/multiplayer-server-recents';
import {
  getRememberedServerHostKey,
  serverHostKeys
} from '$lib/stores/multiplayer-server-host-keys';
import { buildServerInvitationPayload } from './multiplayer-server-invite';
import { ServerError } from './multiplayer-server-http';

const ROOM = 'c'.repeat(32);
const HOST_KEY = 'a'.repeat(64);

function invitation() {
  return {
    endpoint: 'https://server.example.com',
    roomId: ROOM,
    secret: 'invite-secret-9',
    title: 'Friday'
  };
}

function stubNetwork(): ServerSetupNetwork & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchInfo: async (endpoint: string) => {
      calls.push(`info:${endpoint}`);
      return {
        signalingVersion: 1,
        appProtocolMajor: 1,
        appProtocolMinor: 0,
        appCapabilities: [],
        description: 'Test server',
        contact: 'op@example.com',
        iceUrls: [],
        limits: { maxRooms: 4, maxPeersPerRoom: 8, maxPendingAttemptsPerRoom: 8 }
      };
    },
    createSession: async (endpoint: string) => {
      calls.push(`login:${endpoint}`);
      return { sessionToken: 'bearer-1', expiresAt: '2030-01-01T00:00:00Z' };
    },
    deleteSession: async (endpoint: string) => {
      calls.push(`logout:${endpoint}`);
    },
    createRoom: async () => {
      calls.push('create-room');
      return { roomId: ROOM, ownerSecret: 'owner-1', invitationSecret: 'invite-1', expiresAt: '' };
    },
    resumeRoom: async () => {
      calls.push('resume-room');
      return { roomId: ROOM, expiresAt: '' };
    },
    renewRoom: async () => {
      calls.push('renew-room');
      return { roomId: ROOM, expiresAt: '' };
    },
    rotateRoom: async () => {
      calls.push('rotate-room');
      return { roomId: ROOM, invitationSecret: 'invite-2' };
    },
    recreateRoom: async () => {
      calls.push('recreate-room');
      return { roomId: ROOM, ownerSecret: 'owner-1', invitationSecret: 'invite-1', expiresAt: '' };
    },
    deleteRoom: async () => {
      calls.push('delete-room');
    }
  };
}

function stubConnector(): ServerSessionConnector & { calls: string[]; joined: unknown[] } {
  const calls: string[] = [];
  const joined: unknown[] = [];
  return {
    calls,
    joined,
    startHosting: async () => {
      calls.push('host');
      return { endpoint: 'https://server.example.com', roomId: ROOM, secret: 'invite-1', ownerSecret: 'owner-1' };
    },
    joinServer: async (args) => {
      calls.push('join');
      joined.push(args);
    },
    rotateInvitation: async () => {
      calls.push('rotate');
      return 'invite-2';
    },
    stopHosting: async () => {
      calls.push('stop');
    },
    leave: async () => {
      calls.push('leave');
    }
  };
}

beforeEach(() => {
  serverRecents.set([]);
  serverServers.set([]);
  serverHostKeys.set([]);
  multiplayerSettings.update({
    multiplayerServerEndpoint: '',
    multiplayerServerLabel: '',
    multiplayerServerNoticeVersion: SERVER_PROVIDER_NOTICE_VERSION,
    multiplayerServerIceAck: ''
  });
});

describe('server setup controller', () => {
  it('makes no requests until an explicit action runs', () => {
    const network = stubNetwork();
    const controller = createServerSetupController(network);
    controller.openSetup();
    controller.setServerInput('https://server.example.com');
    controller.captureInvitation(invitation());
    controller.dismissPending();
    expect(network.calls).toEqual([]);
    controller.closeSetup();
  });

  it('connects explicitly, normalizes the endpoint, and remembers the server', async () => {
    const network = stubNetwork();
    const controller = createServerSetupController(network);
    controller.setServerInput('https://server.example.com/prefix/');
    await controller.connectServer();
    const snapshot = controller.getSnapshot();
    expect(snapshot.endpoint).toBe('https://server.example.com/prefix');
    expect(snapshot.infoStatus).toBe('ready');
    expect(snapshot.serverInfo?.description).toBe('Test server');
    expect(network.calls).toEqual(['info:https://server.example.com/prefix']);
    expect(serverServers.getSnapshot().map((entry) => entry.endpoint)).toEqual([
      'https://server.example.com/prefix'
    ]);
    expect(multiplayerSettings.getSnapshot().multiplayerServerEndpoint).toBe(
      'https://server.example.com/prefix'
    );
  });

  it('rejects invalid server addresses without a request', async () => {
    const network = stubNetwork();
    const controller = createServerSetupController(network);
    controller.setServerInput('http://server.example.com');
    await controller.connectServer();
    expect(controller.getSnapshot().infoStatus).toBe('error');
    expect(network.calls).toEqual([]);
  });

  it('remembers operator keys per server but never persists login bearers', async () => {
    const network = stubNetwork();
    let receivedKey = '';
    network.createSession = async (_endpoint, hostKey) => {
      receivedKey = hostKey;
      return { sessionToken: 'bearer-1', expiresAt: '2030-01-01T00:00:00Z' };
    };
    const controller = createServerSetupController(network);
    controller.setServerInput('https://server.example.com');
    await controller.connectServer();
    await controller.login(HOST_KEY);
    expect(controller.getSnapshot().hasLogin).toBe(true);
    expect(controller.getSnapshot().hasSavedHostKey).toBe(true);
    expect(controller.getLoginTokenForTest()).toBe('bearer-1');
    expect(getRememberedServerHostKey('https://server.example.com')).toBe(HOST_KEY);
    const persisted = JSON.stringify(multiplayerSettings.getSnapshot())
      + JSON.stringify(serverRecents.getSnapshot())
      + JSON.stringify(serverServers.getSnapshot())
      + JSON.stringify(serverHostKeys.getSnapshot());
    expect(persisted).not.toContain('bearer-1');
    await controller.logout();
    expect(controller.getLoginTokenForTest()).toBeNull();
    expect(network.calls).toContain('logout:https://server.example.com');

    const nextController = createServerSetupController(network);
    nextController.setServerInput('https://server.example.com');
    await nextController.connectServer();
    expect(nextController.getSnapshot().hasSavedHostKey).toBe(true);
    receivedKey = '';
    await nextController.login('');
    expect(receivedKey).toBe(HOST_KEY);
  });

  it('retrieves the dedicated host invite without replacing browser-host room creation', async () => {
    const network = stubNetwork();
    network.fetchDedicatedRoom = async (_endpoint, token) => {
      network.calls.push(`dedicated:${token}`);
      return { roomId: ROOM, invitationSecret: 'dedicated-invite', expiresAt: '2030-01-01T00:00:00Z' };
    };
    const connector = stubConnector();
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://server.example.com');
    await controller.connectServer();
    await controller.login(HOST_KEY);

    expect(controller.getSnapshot().dedicatedInviteLink).toContain(
      `party=https://server.example.com&code=${ROOM}.dedicated-invite`
    );
    expect(connector.calls).toEqual([]);

    await controller.createRoom();
    expect(connector.calls).toEqual(['host']);
    expect(controller.getSnapshot().inviteLink).toContain(`${ROOM}.invite-1`);
  });

  it('forgets a saved operator key when its remember toggle is disabled', async () => {
    const network = stubNetwork();
    const controller = createServerSetupController(network);
    controller.setServerInput('https://server.example.com');
    await controller.connectServer();
    await controller.login(HOST_KEY);
    expect(getRememberedServerHostKey('https://server.example.com')).toBe(HOST_KEY);
    controller.setRememberHostKey(false);
    expect(getRememberedServerHostKey('https://server.example.com')).toBeNull();
    expect(controller.getSnapshot().hasSavedHostKey).toBe(false);
  });

  it('hosts through the session connector and hands over the bearer', async () => {
    const network = stubNetwork();
    const connector = stubConnector();
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://server.example.com');
    await controller.connectServer();
    await controller.login('operator-key-abc');
    controller.setHostRemember(true);
    await controller.createRoom();
    const snapshot = controller.getSnapshot();
    expect(snapshot.hosted?.roomId).toBe(ROOM);
    expect(snapshot.inviteLink).toContain('#party=');
    expect(controller.getLoginTokenForTest()).toBeNull();
    expect(connector.calls).toEqual(['host']);
    const recents = serverRecents.getSnapshot();
    expect(recents[0]).toMatchObject({
      endpoint: 'https://server.example.com',
      roomId: ROOM,
      invitationSecret: 'invite-1',
      ownerSecret: 'owner-1'
    });
    await controller.rotateInvitation();
    expect(controller.getSnapshot().hosted?.invitationSecret).toBe('invite-2');
    await controller.closeRoom();
    expect(controller.getSnapshot().hosted).toBeNull();
    expect(connector.calls).toEqual(['host', 'rotate', 'stop']);
  });

  it('hosts immediately from the endpoint and operator key saved in Options', async () => {
    const network = stubNetwork();
    const connector = stubConnector();
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://server.example.com');
    await controller.connectServer();
    await controller.login(HOST_KEY);
    await controller.logout();
    network.calls.length = 0;

    await controller.hostConfigured();

    expect(network.calls).toEqual([
      'info:https://server.example.com',
      'login:https://server.example.com'
    ]);
    expect(connector.calls).toEqual(['host']);
    expect(controller.getSnapshot().dialogOpen).toBe(false);
  });

  it('treats an expired login as a user action, not a retry', async () => {
    const network = stubNetwork();
    const connector = stubConnector();
    connector.startHosting = async () => {
      throw new ServerError('unauthorized', 401);
    };
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://server.example.com');
    await controller.connectServer();
    await controller.login('stale-key');
    await expect(controller.createRoom()).rejects.toThrow();
    const snapshot = controller.getSnapshot();
    expect(snapshot.hasLogin).toBe(false);
    expect(snapshot.error).toMatch(/expired/i);
  });

  it('fetches server info after Join and uses Server-owned ICE without another setup step', async () => {
    const network = stubNetwork();
    network.fetchInfo = async () => ({
      signalingVersion: 1,
      appProtocolMajor: 1,
      appProtocolMinor: 0,
      appCapabilities: [],
      description: 'Party box',
      contact: '',
      iceUrls: ['stun:stun.example.com'],
      limits: { maxRooms: 4, maxPeersPerRoom: 8, maxPendingAttemptsPerRoom: 8 }
    });
    const connector = stubConnector();
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.captureInvitation(invitation());
    expect(network.calls).toEqual([]);
    controller.setPendingRemember(true);
    await controller.joinPending();
    expect(controller.getSnapshot().guestStatus).toBe('idle');
    expect(connector.calls).toEqual(['join']);
    expect(connector.joined[0]).toMatchObject({ roomId: ROOM, secret: 'invite-secret-9' });
    expect(serverRecents.getSnapshot()[0]).toMatchObject({ invitationSecret: 'invite-secret-9' });
  });

  it('skips the provider prompt when there is nothing new to acknowledge', async () => {
    const network = stubNetwork();
    const connector = stubConnector();
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.captureInvitation(invitation());
    await controller.joinPending();
    expect(controller.getSnapshot().guestStatus).toBe('idle');
    expect(connector.calls).toEqual(['join']);
    // No Remember means no invitation is stored.
    expect(serverRecents.getSnapshot()[0]).toMatchObject({ invitationSecret: null });
  });

  it('redacts invitation material from guest errors', async () => {
    const network = stubNetwork();
    const raw = buildServerInvitationPayload(invitation());
    network.fetchInfo = async () => {
      throw new Error(`fetch failed for #party=${raw}`);
    };
    const connector = stubConnector();
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.captureInvitation(invitation());
    await controller.joinPending();
    const snapshot = controller.getSnapshot();
    expect(snapshot.guestStatus).toBe('error');
    expect(snapshot.guestError).toContain('#party=[redacted]');
    expect(snapshot.guestError).not.toContain(raw);
  });

  it('resumes a live room without recreating it', async () => {
    const network = stubNetwork();
    const connector = stubConnector();
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://server.example.com');
    await controller.connectServer();
    await controller.login('operator-key-abc');
    await controller.resumeOrRecreateRoom(ROOM, 'owner-1');
    expect(connector.calls).toEqual(['host']);
    expect(network.calls).not.toContain('recreate-room');
    expect(controller.getSnapshot().hosted?.roomId).toBe(ROOM);
  });

  it('recreates an absent room with the saved invitation', async () => {
    const network = stubNetwork();
    const connector = stubConnector();
    let attempts = 0;
    connector.startHosting = async () => {
      connector.calls.push('host');
      attempts += 1;
      if (attempts === 1) throw new ServerError('room-unavailable', 404);
      return { endpoint: 'https://server.example.com', roomId: ROOM, secret: 'invite-1', ownerSecret: 'owner-1' };
    };
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://server.example.com');
    await controller.connectServer();
    await controller.login('operator-key-abc');
    serverRecents.set([{
      endpoint: 'https://server.example.com',
      roomId: ROOM,
      displayName: 'Friday',
      lastUsed: Date.now(),
      invitationSecret: 'invite-1',
      ownerSecret: 'owner-1'
    }]);
    await controller.resumeOrRecreateRoom(ROOM, 'owner-1');
    expect(network.calls).toContain('recreate-room');
    expect(connector.calls.filter((call) => call === 'host')).toHaveLength(2);
    expect(controller.getSnapshot().hosted?.roomId).toBe(ROOM);
    expect(controller.getSnapshot().inviteLink).toContain('#party=');
  });

  it('refuses to recreate without a remembered invitation', async () => {
    const network = stubNetwork();
    const connector = stubConnector();
    connector.startHosting = async () => {
      throw new ServerError('room-unavailable', 404);
    };
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://server.example.com');
    await controller.connectServer();
    await controller.login('operator-key-abc');
    await expect(controller.resumeOrRecreateRoom(ROOM, 'owner-1')).rejects.toThrow();
    expect(network.calls).not.toContain('recreate-room');
  });

  it('surfaces live-room collisions instead of recreating', async () => {
    const network = stubNetwork();
    network.recreateRoom = async () => {
      throw new ServerError('room-unavailable', 409);
    };
    const connector = stubConnector();
    connector.startHosting = async (args: unknown) => {
      const resume = (args as { resume?: unknown }).resume;
      if (resume) throw new ServerError('room-unavailable', 404);
      throw new Error('unexpected host without resume');
    };
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://server.example.com');
    await controller.connectServer();
    await controller.login('operator-key-abc');
    serverRecents.set([{
      endpoint: 'https://server.example.com',
      roomId: ROOM,
      displayName: 'Friday',
      lastUsed: Date.now(),
      invitationSecret: 'invite-1',
      ownerSecret: 'owner-1'
    }]);
    await expect(controller.resumeOrRecreateRoom(ROOM, 'owner-1')).rejects.toThrow();
    expect(controller.getSnapshot().error).toBeTruthy();
  });

  it('cancels an in-flight info fetch without side effects', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const network = stubNetwork();
    network.fetchInfo = async () => {
      await gate;
      throw new Error('should have been aborted');
    };
    const connector = stubConnector();
    const controller = createServerSetupController(network);
    controller.setSessionConnector(connector);
    controller.captureInvitation(invitation());
    const pending = controller.joinPending();
    controller.cancelCurrent();
    release();
    await pending;
    expect(controller.getSnapshot().guestStatus).toBe('idle');
    expect(connector.calls).toEqual([]);
  });
});
