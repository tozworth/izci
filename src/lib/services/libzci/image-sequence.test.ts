import { describe, expect, it } from 'vitest';
import {
  serializeImageNavigation,
  stepImageSequence,
  validateImageNavigation,
  validateImageSequence,
  type CoreImageSequence
} from './image-sequence';

const sequence: CoreImageSequence = { revision: 77, media: [11, 22, 33] };

describe('core image sequence boundary', () => {
  it('validates captured sequences', () => {
    expect(() => validateImageSequence(sequence)).not.toThrow();
    expect(() => validateImageSequence({ ...sequence, media: [] })).toThrow();
    expect(() => validateImageSequence({ ...sequence, media: [11, 11] })).toThrow('Duplicate');
    expect(() => validateImageSequence({ ...sequence, revision: -1 })).toThrow();
  });

  it('validates navigation commands and serializes them', () => {
    expect(() => validateImageNavigation({ kind: 'next' })).not.toThrow();
    expect(() => validateImageNavigation({ kind: 'select', media: 22 })).not.toThrow();
    expect(() => validateImageNavigation({ kind: 'select', media: 0 })).toThrow();
    expect(() => validateImageNavigation({ kind: 'bogus' as never })).toThrow();
    expect(JSON.parse(serializeImageNavigation({ kind: 'first' }))).toEqual({ kind: 'first' });
  });

  it('steps with optional wrap', () => {
    expect(stepImageSequence(sequence, 22, 1, false)).toBe(33);
    expect(stepImageSequence(sequence, 33, 1, false)).toBeNull();
    expect(stepImageSequence(sequence, 33, 1, true)).toBe(11);
    expect(stepImageSequence(sequence, 11, -1, false)).toBeNull();
    expect(stepImageSequence(sequence, 11, -1, true)).toBe(33);
    expect(stepImageSequence(sequence, null, 1, false)).toBe(11);
    expect(stepImageSequence(sequence, 999, -1, false)).toBe(33);
  });
});
