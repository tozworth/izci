import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistItem } from '$lib/types';

const wireHarness = vi.hoisted(() => {
  const track = { readyState: 'live', stop: vi.fn(), contentHint: '' };
  const destination = {
    channelCount: 0,
    stream: { getAudioTracks: () => [track], getTracks: () => [track] },
    disconnect: vi.fn()
  };
  const constant = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    createMediaStreamDestination: vi.fn(() => destination),
    createConstantSource: vi.fn(() => constant),
    createGain: vi.fn(() => gain)
  };
  return { track, destination, constant, gain, context, resume: vi.fn(async () => true) };
});

vi.mock('$lib/services/audio-bus', () => ({
  audioBusService: { context: wireHarness.context, resume: wireHarness.resume }
}));

import { createFreeplayStepResolver, MultiplayerFreeplayPlayer } from './multiplayer-freeplay';

function track(id: string): PlaylistItem {
  return {
    id,
    name: `${id}.mp3`,
    extension: 'mp3',
    kind: 'stream',
    size: 1,
    lastModified: 1
  };
}

describe('Freeplay navigation', () => {
  const tracks = [track('a'), track('b'), track('c')];

  it('steps and wraps independently within the browsed host collection', () => {
    const resolver = createFreeplayStepResolver(() => tracks);
    expect(resolver.resolveStep({ currentId: 'a', direction: 1, shuffle: false, wrap: false })?.id).toBe('b');
    expect(resolver.resolveStep({ currentId: 'c', direction: 1, shuffle: false, wrap: true })?.id).toBe('a');
    expect(resolver.resolveStep({ currentId: 'a', direction: -1, shuffle: false, wrap: true })?.id).toBe('c');
  });

  it('keeps shuffle history so previous returns to what was actually played', () => {
    const resolver = createFreeplayStepResolver(() => tracks);
    const next = resolver.resolveStep({ currentId: 'b', direction: 1, shuffle: true, wrap: false });
    expect(next?.id).not.toBe('b');
    expect(resolver.resolveStep({ currentId: next?.id, direction: -1, shuffle: true, wrap: false })?.id).toBe('b');
  });
});

describe('Freeplay delivery ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps one silent sender track alive for the lifetime of a peer player', async () => {
    const player = new MultiplayerFreeplayPlayer({
      getAudioSettings: () => ({ enabled: true, sourceFile: false, postRaf: false }),
      onUpdate: () => undefined,
      onEnded: () => undefined
    });

    const [first, second] = await Promise.all([player.ensureWire(), player.ensureWire()]);

    expect(first).toBe(wireHarness.track);
    expect(second).toBe(first);
    expect(wireHarness.context.createMediaStreamDestination).toHaveBeenCalledTimes(1);
    expect(wireHarness.constant.start).toHaveBeenCalledTimes(1);
    expect(wireHarness.gain.gain.value).toBe(0);
    player.destroy();
    expect(wireHarness.track.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the host timeline passive for source-file delivery', async () => {
    const updates: Array<{ state: string; time: number; delivery: string }> = [];
    const player = new MultiplayerFreeplayPlayer({
      getAudioSettings: () => ({ enabled: true, sourceFile: true, postRaf: false }),
      onUpdate: (update) => updates.push({
        state: update.playback.snapshot.state,
        time: update.playback.snapshot.currentTime,
        delivery: update.delivery
      }),
      onEnded: () => { throw new Error('The passive host must not synthesize an ended event.'); }
    });
    const source = { ...track('source'), file: new File(['audio'], 'source.mp3') };

    expect(await player.load(source, true, 75)).toBe(true);
    expect(player.delivery).toBe('source-file');
    expect(player.snapshot).toMatchObject({ state: 'idle', currentTime: 0 });
    expect(updates.at(-1)).toEqual({ state: 'idle', time: 0, delivery: 'source-file' });
  });

  it('preserves play intent while audio delivery is reconfigured through none', async () => {
    let enabled = true;
    const player = new MultiplayerFreeplayPlayer({
      getAudioSettings: () => ({ enabled, sourceFile: true, postRaf: false }),
      onUpdate: () => undefined,
      onEnded: () => undefined
    });
    const source = { ...track('source'), file: new File(['audio'], 'source.mp3') };

    expect(await player.load(source, true)).toBe(true);
    enabled = false;
    expect(await player.reconfigure()).toBe(true);
    expect(player.delivery).toBe('none');
  });
});
