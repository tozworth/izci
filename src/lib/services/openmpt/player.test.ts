import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPENMPT_SETTINGS, type OpenMptEvent } from './protocol';

const bytes = vi.hoisted(() => vi.fn(async () => new ArrayBuffer(8)));
vi.mock('./assets', () => ({ loadOpenMptBytes: bytes }));

class FakeNode {
  static all: FakeNode[] = [];
  port = { onmessage: null as ((event: { data: OpenMptEvent }) => void) | null, postMessage: vi.fn(), close: vi.fn() };
  onprocessorerror: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  constructor() { FakeNode.all.push(this); }
  emit(event: OpenMptEvent): void { this.port.onmessage?.({ data: event }); }
}

import { OpenMptPlayer } from './player';

async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

describe('worklet controller handshake and ownership', () => {
  const contexts: { audioWorklet: { addModule: ReturnType<typeof vi.fn> }; createGain: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
  const players: OpenMptPlayer[] = [];
  const context = () => {
    const value = { audioWorklet: { addModule: vi.fn(async () => undefined) }, createGain: vi.fn(() => ({ disconnect: vi.fn() })), close: vi.fn() };
    contexts.push(value);
    return value as unknown as AudioContext;
  };
  beforeEach(() => {
    contexts.length = 0;
    players.length = 0;
    FakeNode.all = [];
    bytes.mockReset().mockResolvedValue(new ArrayBuffer(8));
    vi.stubGlobal('AudioWorkletNode', FakeNode);
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const player of players) player.dispose();
    for (const node of FakeNode.all) node.emit({ type: 'disposed' });
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function ready(ctx = context()): Promise<OpenMptPlayer> {
    const pending = OpenMptPlayer.create(ctx);
    await flush();
    FakeNode.all.at(-1)!.emit({ type: 'ready' });
    const player = await pending;
    players.push(player);
    return player;
  }

  it('waits for WASM readiness and registers the worklet once per context', async () => {
    const ctx = context();
    const pending = OpenMptPlayer.create(ctx);
    const resolved = vi.fn();
    void pending.then(resolved);
    await flush();
    expect(resolved).not.toHaveBeenCalled();
    FakeNode.all[0].emit({ type: 'ready' });
    players.push(await pending);
    await ready(ctx);
    expect(contexts[0].audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(contexts[0].close).not.toHaveBeenCalled();
  });

  it('loads paused with a transfer and waits for the selected subsong metadata', async () => {
    const player = await ready();
    const node = FakeNode.all[0];
    const buffer = new ArrayBuffer(8);
    const loading = player.load(buffer, 2, DEFAULT_OPENMPT_SETTINGS);
    expect(node.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'load', buffer, subsong: 2 }), [buffer]);
    expect(node.port.postMessage.mock.calls.some(([event]) => event.type === 'play')).toBe(false);
    const inspection = { metadata: { duration: 1500 }, subsong: 2 };
    node.emit({ type: 'loaded', id: 1, inspection });
    expect(await loading).toEqual(inspection);
    expect(player.duration).toBe(1500);
    const error = vi.fn();
    player.handlers.error = error;
    player.dispose();
    expect(error).not.toHaveBeenCalled();
    expect(node.port.close).not.toHaveBeenCalled();
    node.emit({ type: 'disposed' });
    expect(node.port.close).toHaveBeenCalledOnce();
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(contexts[0].close).not.toHaveBeenCalled();
  });

  it('fails initialization explicitly and releases a timed-out node', async () => {
    const pending = OpenMptPlayer.create(context());
    const failed = expect(pending).rejects.toThrow('initialization timed out');
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(FakeNode.all[0].port.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    FakeNode.all[0].emit({ type: 'disposed' });
    expect(FakeNode.all[0].port.close).toHaveBeenCalledOnce();
  });

  it('rejects pending load on processor failure and stops sending commands', async () => {
    const player = await ready();
    const node = FakeNode.all[0];
    const loading = player.load(new ArrayBuffer(8), 0, DEFAULT_OPENMPT_SETTINGS);
    const failed = expect(loading).rejects.toThrow('processor failed');
    const error = vi.fn();
    player.handlers.error = error;
    node.onprocessorerror?.();
    await failed;
    expect(error).toHaveBeenCalledOnce();
    const count = node.port.postMessage.mock.calls.length;
    player.play();
    expect(node.port.postMessage.mock.calls.length).toBe(count);
  });

  it('retries failed registration and times out asset loading before creating nodes', async () => {
    const ctx = context();
    contexts[0].audioWorklet.addModule.mockRejectedValueOnce(new Error('registration failed'));
    await expect(OpenMptPlayer.create(ctx)).rejects.toThrow('registration failed');
    await ready(ctx);
    expect(contexts[0].audioWorklet.addModule).toHaveBeenCalledTimes(2);
    bytes.mockImplementationOnce(() => new Promise(() => undefined));
    const loading = OpenMptPlayer.create(context());
    const failed = expect(loading).rejects.toThrow('runtime loading timed out');
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(FakeNode.all).toHaveLength(1);
  });
});
