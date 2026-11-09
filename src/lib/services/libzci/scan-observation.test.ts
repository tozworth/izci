import { describe, expect, it } from 'vitest';
import {
  idleScanObservation,
  isScanActive,
  isScanFailed,
  validateScanObservation,
  type CoreScanObservation
} from './scan-observation';

const scanning: CoreScanObservation = {
  state: 'scanning',
  root: 3,
  visited: 100,
  accepted: 12,
  ignored: 4,
  detail: 'Checking directory access'
};

describe('core scan observation', () => {
  it('validates observations and flags activity', () => {
    expect(() => validateScanObservation(scanning)).not.toThrow();
    expect(isScanActive(scanning)).toBe(true);
    expect(isScanFailed(scanning)).toBe(false);
    expect(idleScanObservation()).toEqual({ state: 'idle', root: null, visited: 0, accepted: 0, ignored: 0, detail: '' });
    expect(() => validateScanObservation({ ...scanning, state: 'bogus' as never })).toThrow();
    expect(() => validateScanObservation({ ...scanning, root: 0 })).toThrow();
    expect(() => validateScanObservation({ ...scanning, detail: 'x'.repeat(4097) })).toThrow();
    expect(isScanFailed({ ...scanning, state: 'failed', detail: 'denied' })).toBe(true);
  });
});
