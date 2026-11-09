import { describe, expect, it } from 'vitest';
import {
  effectiveLinearGain,
  isNormalizationActive,
  validateCoreNormalization,
  type CoreNormalization
} from './normalization';

const active: CoreNormalization = { origin: 'track', gain_db: -6, linear: 0.5, clipping_limited: false };
const idle: CoreNormalization = { origin: 'off', gain_db: 0, linear: 1, clipping_limited: false };

describe('core normalization observation', () => {
  it('validates snapshots and flags active gains', () => {
    expect(() => validateCoreNormalization(active)).not.toThrow();
    expect(isNormalizationActive(active)).toBe(true);
    expect(isNormalizationActive(idle)).toBe(false);
    expect(effectiveLinearGain(active)).toBe(0.5);
    expect(() => validateCoreNormalization({ ...active, origin: 'bogus' as never })).toThrow();
    expect(() => validateCoreNormalization({ ...active, linear: Number.NaN })).toThrow();
  });
});
