import { describe, expect, it, vi } from 'vitest';
import { joinServer, startServerHosting } from './multiplayer-server-session';
import type { MultiplayerClientContext } from './multiplayer-client';
import type { MultiplayerHostContext } from './multiplayer-host';

describe('server transport replacement', () => {
  it.each(['joining', 'hosting'] as const)('retains previous host ownership for shared teardown when %s', async (operation) => {
    const previousHost = { dispose: vi.fn() };
    const previousGuest = { dispose: vi.fn() };
    const previousTransport = vi.fn();
    const stopped = new Error('stop at teardown');
    const core = {
      transportGeneration: 2,
      multiplayerSettings: { multiplayerMaxListeners: 4 },
      serverHost: previousHost,
      serverGuest: previousGuest,
      disposeServerTransport: previousTransport,
      resetSession: vi.fn(async () => {
        // Teardown owns closing/revoking the old room and stopping its native
        // server. Prematurely clearing these references leaked both on Join.
        expect(core.serverHost).toBe(previousHost);
        expect(core.serverGuest).toBe(previousGuest);
        expect(core.disposeServerTransport).toBe(previousTransport);
        throw stopped;
      })
    };
    const run = operation === 'joining'
      ? joinServer({ core } as unknown as MultiplayerClientContext, { endpoint: 'https://signal.example.com', roomId: 'a'.repeat(32), secret: 'invitation' })
      : startServerHosting({ core } as unknown as MultiplayerHostContext, { endpoint: 'https://signal.example.com', hostKey: '' });
    await expect(run).rejects.toBe(stopped);
    expect(core.resetSession).toHaveBeenCalledWith(true);
    expect(previousHost.dispose).not.toHaveBeenCalled();
  });
});
