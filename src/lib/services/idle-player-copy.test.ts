import { describe, expect, it } from 'vitest';
import { IDLE_PLAYER_QUIPS, pickIdlePlayerQuip } from './idle-player-copy';

describe('idle player copy', () => {
  it('keeps a curated repository of 35 quips', () => {
    expect(IDLE_PLAYER_QUIPS).toHaveLength(35);
    expect(new Set(IDLE_PLAYER_QUIPS).size).toBe(35);
  });

  it('selects a quip from the supplied random value', () => {
    expect(pickIdlePlayerQuip(() => 0)).toBe(IDLE_PLAYER_QUIPS[0]);
    expect(pickIdlePlayerQuip(() => 0.999)).toBe(IDLE_PLAYER_QUIPS[34]);
  });
});
