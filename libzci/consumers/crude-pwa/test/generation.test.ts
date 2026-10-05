import { describe, expect, it } from 'vitest';
import { coalesceProgress, isCurrent, parseWorkerError } from '../src/generation.js';

describe('generation fencing', () => {
  it('rejects stale results after a seek', () => {
    const current = { session: 1, generation: 3 };
    expect(isCurrent({ session: 1, generation: 2 }, current)).toBe(false);
    expect(isCurrent({ session: 1, generation: 3 }, current)).toBe(true);
    expect(isCurrent({ session: 2, generation: 3 }, current)).toBe(false);
  });

  it('coalesces progress to the latest per session', () => {
    const events = [
      { session: 1, generation: 1, pos: 10 },
      { session: 1, generation: 1, pos: 20 },
      { session: 2, generation: 5, pos: 1 },
    ];
    const merged = coalesceProgress(events, 10);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.session === 1)?.pos).toBe(20);
  });

  it('parses worker errors without throwing', () => {
    expect(parseWorkerError({ kind: 'corrupt', detail: 'bad page' })).toEqual({
      kind: 'corrupt',
      detail: 'bad page',
    });
    expect(parseWorkerError(new Error('boom')).kind).toBe('internal');
    expect(parseWorkerError(42).kind).toBe('unknown');
  });
});
