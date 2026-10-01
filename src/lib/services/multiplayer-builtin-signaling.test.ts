import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$platform', () => ({
  isDesktop: true, startBuiltinSignaling: vi.fn(), stopBuiltinSignaling: vi.fn(),
  fetchSignaling: (url: string, init?: RequestInit) => fetch(url, init)
}));

import { createServerSetupController, type BuiltinSignalingRuntime, type ServerSessionConnector } from './multiplayer-server-setup';
import { DEFAULT_MULTIPLAYER_SETTINGS, multiplayerSettings, normalizeMultiplayerSettings } from '$lib/stores/multiplayer-settings';
import { serverHostKeys } from '$lib/stores/multiplayer-server-host-keys';
import { serverRecents } from '$lib/stores/multiplayer-server-recents';
import { parseServerInviteText } from './multiplayer-server-invite';

const roomId = 'a'.repeat(32);
const local = 'http://127.0.0.1:8787';
const lan = 'http://192.168.1.42:8787';
function runtime(): BuiltinSignalingRuntime {
  return {
    available: true,
    start: vi.fn(async () => ({ endpoint: local, publicEndpoint: lan, lanEndpoints: [lan], sessionToken: 'pipe-private-bearer', mapping: 'off' as const })),
    stop: vi.fn(async () => undefined)
  };
}
function connector(): ServerSessionConnector {
  return {
    startHosting: vi.fn(async () => ({ endpoint: local, roomId, secret: 'invite-secret', ownerSecret: 'owner-secret' })),
    stopHosting: vi.fn(async () => undefined),
    rotateInvitation: vi.fn(async () => 'rotated-secret'),
    joinServer: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined)
  };
}
beforeEach(() => { multiplayerSettings.reset(); serverHostKeys.set([]); serverRecents.set([]); });

describe('desktop built-in signaling flow', () => {
  it('defaults to built-in and bounds persisted server preferences', () => {
    expect(DEFAULT_MULTIPLAYER_SETTINGS.multiplayerSignaling).toBe('builtin');
    expect(normalizeMultiplayerSettings({ multiplayerBuiltinPort: 70000 }).multiplayerBuiltinPort).toBe(65535);
    expect(normalizeMultiplayerSettings({ multiplayerBuiltinPort: NaN }).multiplayerBuiltinPort).toBe(8787);
  });

  it('does no native startup until Host, then hosts without key/login or persisted owner secrets', async () => {
    const native = runtime();
    const session = connector();
    const controller = createServerSetupController(undefined, native);
    controller.setSessionConnector(session);
    controller.openSetup();
    expect(native.start).not.toHaveBeenCalled();
    multiplayerSettings.update({ multiplayerBuiltinUpnp: true });
    await controller.hostConfigured();
    expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ port: 8787, upnp: true }));
    expect(session.startHosting).toHaveBeenCalledWith(expect.objectContaining({ endpoint: local, hostKey: '', sessionToken: 'pipe-private-bearer' }));
    const snapshot = controller.getSnapshot();
    expect(snapshot.inviteLink).toMatch(/^https:\/\/izci\.xn--ala-hsa\.net\//);
    expect(snapshot.builtin).not.toHaveProperty('sessionToken');
    expect(parseServerInviteText(snapshot.inviteLink!)).toMatchObject({ endpoint: lan, roomId, secret: 'invite-secret' });
    expect(serverHostKeys.getSnapshot()).toEqual([]);
    expect(serverRecents.getSnapshot()).toEqual([]);
    expect(multiplayerSettings.getSnapshot().multiplayerServerEndpoint).toBe('');
  });

  it('keeps the advertised address on invitation rotation', async () => {
    const native = runtime();
    const session = connector();
    const controller = createServerSetupController(undefined, native);
    controller.setSessionConnector(session);
    await controller.hostConfigured();
    await controller.rotateInvitation();
    expect(parseServerInviteText(controller.getSnapshot().inviteLink!)).toMatchObject({ endpoint: lan, secret: 'rotated-secret' });
  });

  it('reclaims the native server when room creation fails', async () => {
    const native = runtime();
    const session = connector();
    vi.mocked(session.startHosting).mockRejectedValue(new Error('room failed'));
    const controller = createServerSetupController(undefined, native);
    controller.setSessionConnector(session);
    await expect(controller.hostConfigured()).rejects.toThrow('room failed');
    expect(native.stop).toHaveBeenCalledWith(local);
    expect(controller.getSnapshot()).toMatchObject({ busy: null, hosted: null, builtin: null });
  });

  it('reclaims a server that finishes starting after cancellation', async () => {
    const native = runtime();
    const session = connector();
    let finish!: (value: Awaited<ReturnType<BuiltinSignalingRuntime['start']>>) => void;
    const ready = await native.start({ port: 8787, publicUrl: '', upnp: false, iceUrls: [], allowedOrigins: [] });
    vi.mocked(native.start).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const controller = createServerSetupController(undefined, native);
    controller.setSessionConnector(session);
    const hosting = controller.hostConfigured();
    await vi.waitFor(() => expect(finish).toBeDefined());
    controller.cancelCurrent();
    finish(ready);
    await expect(hosting).rejects.toThrow('cancelled');
    expect(native.stop).toHaveBeenCalledWith(local);
    expect(session.startHosting).not.toHaveBeenCalled();
  });

  it.each(['builtin', 'external'] as const)('joins either destination while hosting preference is %s', async (preference) => {
    const native = runtime();
    const session = connector();
    const controller = createServerSetupController({ fetchInfo: vi.fn(async () => ({})) } as never, native);
    controller.setSessionConnector(session);
    multiplayerSettings.update({ multiplayerSignaling: preference });
    for (const endpoint of [lan, 'https://signal.example.com']) {
      await controller.joinInvitation({ endpoint, roomId, secret: 'guest-invite', title: null });
      expect(session.joinServer).toHaveBeenLastCalledWith(expect.objectContaining({ endpoint }));
    }
    expect(native.start).not.toHaveBeenCalled();
  });
});
