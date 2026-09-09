import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSidekickSetupController,
  SIDEKICK_PROVIDER_NOTICE_VERSION,
  type SidekickSetupNetwork,
  type SidekickSessionConnector
} from './multiplayer-sidekick-setup';
import { multiplayerSettings } from '$lib/stores/multiplayer-settings';
import { sidekickRecents, sidekickServers } from '$lib/stores/multiplayer-sidekick-recents';
import { buildSidekickInvitationPayload } from './multiplayer-sidekick-invite';
import { SidekickError } from './multiplayer-sidekick-http';

const ROOM = 'c'.repeat(32);

function invitation() {
  return {
    endpoint: 'https://sidekick.example.com',
    roomId: ROOM,
    secret: 'invite-secret-9',
    title: 'Friday'
  };
}

function stubNetwork(): SidekickSetupNetwork & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchInfo: async (endpoint: string) => {
      calls.push(`info:${endpoint}`);
      return {
        signalingVersion: 1,
        appProtocolVersion: 1,
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

function stubConnector(): SidekickSessionConnector & { calls: string[]; joined: unknown[] } {
  const calls: string[] = [];
  const joined: unknown[] = [];
  return {
    calls,
    joined,
    startHosting: async () => {
      calls.push('host');
      return { endpoint: 'https://sidekick.example.com', roomId: ROOM, secret: 'invite-1', ownerSecret: 'owner-1' };
    },
    joinSidekick: async (args) => {
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
  sidekickRecents.set([]);
  sidekickServers.set([]);
  multiplayerSettings.update({
    multiplayerSidekickEndpoint: '',
    multiplayerSidekickLabel: '',
    multiplayerSidekickNoticeVersion: SIDEKICK_PROVIDER_NOTICE_VERSION,
    multiplayerSidekickIceAck: ''
  });
});

describe('sidekick setup controller', () => {
  it('makes no requests until an explicit action runs', () => {
    const network = stubNetwork();
    const controller = createSidekickSetupController(network);
    controller.openSetup();
    controller.setServerInput('https://sidekick.example.com');
    controller.captureInvitation(invitation());
    controller.dismissPending();
    expect(network.calls).toEqual([]);
    controller.closeSetup();
  });

  it('connects explicitly, normalizes the endpoint, and remembers the server', async () => {
    const network = stubNetwork();
    const controller = createSidekickSetupController(network);
    controller.setServerInput('https://sidekick.example.com/prefix/');
    await controller.connectServer();
    const snapshot = controller.getSnapshot();
    expect(snapshot.endpoint).toBe('https://sidekick.example.com/prefix');
    expect(snapshot.infoStatus).toBe('ready');
    expect(snapshot.serverInfo?.description).toBe('Test server');
    expect(network.calls).toEqual(['info:https://sidekick.example.com/prefix']);
    expect(sidekickServers.getSnapshot().map((entry) => entry.endpoint)).toEqual([
      'https://sidekick.example.com/prefix'
    ]);
    expect(multiplayerSettings.getSnapshot().multiplayerSidekickEndpoint).toBe(
      'https://sidekick.example.com/prefix'
    );
  });

  it('rejects invalid server addresses without a request', async () => {
    const network = stubNetwork();
    const controller = createSidekickSetupController(network);
    controller.setServerInput('http://sidekick.example.com');
    await controller.connectServer();
    expect(controller.getSnapshot().infoStatus).toBe('error');
    expect(network.calls).toEqual([]);
  });

  it('keeps operator keys and bearers in memory only', async () => {
    const network = stubNetwork();
    const controller = createSidekickSetupController(network);
    controller.setServerInput('https://sidekick.example.com');
    await controller.connectServer();
    await controller.login('operator-key-abc');
    expect(controller.getSnapshot().hasLogin).toBe(true);
    expect(controller.getLoginTokenForTest()).toBe('bearer-1');
    const persisted = JSON.stringify(multiplayerSettings.getSnapshot())
      + JSON.stringify(sidekickRecents.getSnapshot())
      + JSON.stringify(sidekickServers.getSnapshot());
    expect(persisted).not.toContain('operator-key-abc');
    expect(persisted).not.toContain('bearer-1');
    await controller.logout();
    expect(controller.getLoginTokenForTest()).toBeNull();
    expect(network.calls).toContain('logout:https://sidekick.example.com');
  });

  it('hosts through the session connector and hands over the bearer', async () => {
    const network = stubNetwork();
    const connector = stubConnector();
    const controller = createSidekickSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://sidekick.example.com');
    await controller.connectServer();
    await controller.login('operator-key-abc');
    controller.setHostRemember(true);
    await controller.createRoom();
    const snapshot = controller.getSnapshot();
    expect(snapshot.hosted?.roomId).toBe(ROOM);
    expect(snapshot.inviteLink).toContain('#party=');
    expect(controller.getLoginTokenForTest()).toBeNull();
    expect(connector.calls).toEqual(['host']);
    const recents = sidekickRecents.getSnapshot();
    expect(recents[0]).toMatchObject({
      endpoint: 'https://sidekick.example.com',
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

  it('treats an expired login as a user action, not a retry', async () => {
    const network = stubNetwork();
    const connector = stubConnector();
    connector.startHosting = async () => {
      throw new SidekickError('unauthorized', 401);
    };
    const controller = createSidekickSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://sidekick.example.com');
    await controller.connectServer();
    await controller.login('stale-key');
    await expect(controller.createRoom()).rejects.toThrow();
    const snapshot = controller.getSnapshot();
    expect(snapshot.hasLogin).toBe(false);
    expect(snapshot.error).toMatch(/expired/i);
  });

  it('fetches server info only after Join and gates new ICE providers', async () => {
    const network = stubNetwork();
    network.fetchInfo = async () => ({
      signalingVersion: 1,
      appProtocolVersion: 1,
      description: 'Party box',
      contact: '',
      iceUrls: ['stun:stun.example.com'],
      limits: { maxRooms: 4, maxPeersPerRoom: 8, maxPendingAttemptsPerRoom: 8 }
    });
    const connector = stubConnector();
    const controller = createSidekickSetupController(network);
    controller.setSessionConnector(connector);
    controller.captureInvitation(invitation());
    expect(network.calls).toEqual([]);
    await controller.joinPending();
    expect(controller.getSnapshot().guestStatus).toBe('awaiting-providers');
    expect(connector.calls).toEqual([]);
    controller.setPendingRemember(true);
    await controller.acknowledgeProvidersAndConnect();
    expect(connector.calls).toEqual(['join']);
    expect(connector.joined[0]).toMatchObject({ roomId: ROOM, secret: 'invite-secret-9' });
    expect(sidekickRecents.getSnapshot()[0]).toMatchObject({ invitationSecret: 'invite-secret-9' });
    expect(multiplayerSettings.getSnapshot().multiplayerSidekickIceAck).toContain('stun:stun.example.com');
  });

  it('skips the provider prompt when there is nothing new to acknowledge', async () => {
    const network = stubNetwork();
    const connector = stubConnector();
    const controller = createSidekickSetupController(network);
    controller.setSessionConnector(connector);
    controller.captureInvitation(invitation());
    await controller.joinPending();
    expect(controller.getSnapshot().guestStatus).toBe('idle');
    expect(connector.calls).toEqual(['join']);
    // No Remember means no invitation is stored.
    expect(sidekickRecents.getSnapshot()[0]).toMatchObject({ invitationSecret: null });
  });

  it('redacts invitation material from guest errors', async () => {
    const network = stubNetwork();
    const raw = buildSidekickInvitationPayload(invitation());
    network.fetchInfo = async () => {
      throw new Error(`fetch failed for #party=${raw}`);
    };
    const connector = stubConnector();
    const controller = createSidekickSetupController(network);
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
    const controller = createSidekickSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://sidekick.example.com');
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
      if (attempts === 1) throw new SidekickError('room-unavailable', 404);
      return { endpoint: 'https://sidekick.example.com', roomId: ROOM, secret: 'invite-1', ownerSecret: 'owner-1' };
    };
    const controller = createSidekickSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://sidekick.example.com');
    await controller.connectServer();
    await controller.login('operator-key-abc');
    sidekickRecents.set([{
      endpoint: 'https://sidekick.example.com',
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
      throw new SidekickError('room-unavailable', 404);
    };
    const controller = createSidekickSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://sidekick.example.com');
    await controller.connectServer();
    await controller.login('operator-key-abc');
    await expect(controller.resumeOrRecreateRoom(ROOM, 'owner-1')).rejects.toThrow();
    expect(network.calls).not.toContain('recreate-room');
  });

  it('surfaces live-room collisions instead of recreating', async () => {
    const network = stubNetwork();
    network.recreateRoom = async () => {
      throw new SidekickError('room-unavailable', 409);
    };
    const connector = stubConnector();
    connector.startHosting = async (args: unknown) => {
      const resume = (args as { resume?: unknown }).resume;
      if (resume) throw new SidekickError('room-unavailable', 404);
      throw new Error('unexpected host without resume');
    };
    const controller = createSidekickSetupController(network);
    controller.setSessionConnector(connector);
    controller.setServerInput('https://sidekick.example.com');
    await controller.connectServer();
    await controller.login('operator-key-abc');
    sidekickRecents.set([{
      endpoint: 'https://sidekick.example.com',
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
    const controller = createSidekickSetupController(network);
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
