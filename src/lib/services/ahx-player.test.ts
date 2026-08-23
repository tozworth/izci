import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';

const harness = vi.hoisted(() => ({
  context: null as AudioContext | null
}));

vi.mock('$lib/services/audio-bus', () => ({
  audioBusService: {
    get context() { return harness.context; },
    connectAudioNode: vi.fn(),
    resume: vi.fn(),
    setSourceGain: vi.fn()
  }
}));
vi.mock('$lib/services/logging', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn()
}));
vi.mock('$lib/services/media-session', () => ({
  mediaSessionService: {
    activateTransportAnchor: vi.fn(),
    pauseTransportAnchor: vi.fn(),
    playTransportAnchor: vi.fn()
  }
}));

const track = {
  id: 'hively-1',
  name: 'Retry.hvl',
  extension: 'hvl',
  kind: 'module',
  size: 3,
  lastModified: 1,
  file: { arrayBuffer: vi.fn(async () => new ArrayBuffer(3)) } as unknown as File
} satisfies TrackItem;

function response(ok: boolean, status: number): Response {
  return {
    ok,
    status,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(8))
  } as unknown as Response;
}

async function createPlayer() {
  const { HivelyPlayerService } = await import('./ahx-player');
  return new HivelyPlayerService(vi.fn(), vi.fn(), vi.fn(), vi.fn());
}

describe('Hively runtime asset retries', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('document', { baseURI: 'https://example.test/' });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('retries a rejected worklet load while retaining successful WASM bytes', async () => {
    const addModule = vi.fn()
      .mockRejectedValueOnce(new Error('first worklet failure'))
      .mockRejectedValueOnce(new Error('second worklet failure'));
    harness.context = { audioWorklet: { addModule } } as unknown as AudioContext;
    const fetchRuntime = vi.fn(async () => response(true, 200));
    vi.stubGlobal('fetch', fetchRuntime);
    const player = await createPlayer();

    await expect(player.load(track)).rejects.toThrow('first worklet failure');
    await expect(player.load(track)).rejects.toThrow('second worklet failure');

    expect(addModule).toHaveBeenCalledTimes(2);
    expect(fetchRuntime).toHaveBeenCalledOnce();
  });

  it('retries rejected WASM bytes while retaining a successful worklet load', async () => {
    const addModule = vi.fn(async () => undefined);
    harness.context = { audioWorklet: { addModule } } as unknown as AudioContext;
    const fetchRuntime = vi.fn()
      .mockResolvedValueOnce(response(false, 503))
      .mockResolvedValueOnce(response(false, 504));
    vi.stubGlobal('fetch', fetchRuntime);
    const player = await createPlayer();

    await expect(player.load(track)).rejects.toThrow('503');
    await expect(player.load(track)).rejects.toThrow('504');

    expect(fetchRuntime).toHaveBeenCalledTimes(2);
    expect(addModule).toHaveBeenCalledOnce();
  });
});
