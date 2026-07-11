import { describe, expect, it } from 'vitest';
import { IDLE_PLAYER_QUIPS, pickIdlePlayerQuip } from './idle-player-copy';

describe('idle player copy', () => {
  it('keeps a non-empty repository of unique quips', () => {
    expect(IDLE_PLAYER_QUIPS.length).toBeGreaterThan(0);
    expect(new Set(IDLE_PLAYER_QUIPS).size).toBe(IDLE_PLAYER_QUIPS.length);
  });

  it('selects a quip from the supplied random value', () => {
    expect(pickIdlePlayerQuip(() => 0)).toBe(IDLE_PLAYER_QUIPS[0]);
    expect(pickIdlePlayerQuip(() => 0.999)).toBe(IDLE_PLAYER_QUIPS.at(-1));
  });
});
