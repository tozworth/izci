import { describe, expect, it } from 'vitest';
import {
  makeFileStageKey,
  makeRootStageKey,
  makeScanFileKey,
  validateCapabilityKey
} from './capability-keys';

describe('core capability stage keys', () => {
  it('builds ingest, root, and scan keys', () => {
    expect(makeFileStageKey('req-1', 0)).toBe('req-1/0');
    expect(makeRootStageKey('req-1')).toBe('req-1/root');
    const digest = 'a'.repeat(64);
    expect(makeScanFileKey('cap/root', digest)).toBe(`cap/root/file/${digest}`);
    expect(() => validateCapabilityKey('cap/root')).not.toThrow();
  });

  it('rejects malformed requests, indices, and digests', () => {
    expect(() => makeFileStageKey('', 0)).toThrow();
    expect(() => makeFileStageKey('req/1', 0)).toThrow();
    expect(() => makeFileStageKey('req-1', -1)).toThrow();
    expect(() => makeRootStageKey('')).toThrow();
    expect(() => makeScanFileKey('cap/root', 'xyz')).toThrow();
    expect(() => validateCapabilityKey('')).toThrow();
    expect(() => validateCapabilityKey('x'.repeat(8193))).toThrow();
  });
});
