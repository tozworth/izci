import { describe, expect, it } from 'vitest';
import type { PlaylistItem } from '$lib/types';
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
});
