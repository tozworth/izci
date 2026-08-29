import { describe, expect, it } from 'vitest';
import { IDLE_PLAYER_QUIPS, pickIdlePlayerQuip } from './idle-player-copy';

describe('idle player copy', () => {
  it('selects a quip from the supplied random value', () => {
    expect(pickIdlePlayerQuip(() => 0)).toBe(IDLE_PLAYER_QUIPS[0]);
    expect(pickIdlePlayerQuip(() => 0.999)).toBe(IDLE_PLAYER_QUIPS.at(-1));
  });

  it('clamps out-of-range indices to the quip bounds', () => {
    expect(pickIdlePlayerQuip(() => 2)).toBe(IDLE_PLAYER_QUIPS.at(-1));
  });
});
