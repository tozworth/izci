import { describe, expect, it } from 'vitest';
import { scanBatchCount, validateStageBatch } from './scan-batch';

describe('scan staging batches', () => {
  it('validates batch envelopes', () => {
    expect(() => validateStageBatch('scan-1-abc', [{}])).not.toThrow();
    expect(() => validateStageBatch('scan-1-abc', new Array(256).fill({}))).not.toThrow();
    expect(() => validateStageBatch('', [{}])).toThrow();
    expect(() => validateStageBatch('scan-1-abc', [])).toThrow('1..256');
    expect(() => validateStageBatch('scan-1-abc', new Array(257).fill({}))).toThrow('1..256');
  });

  it('counts batches for entry totals', () => {
    expect(scanBatchCount(0)).toBe(0);
    expect(scanBatchCount(256)).toBe(1);
    expect(scanBatchCount(257)).toBe(2);
    expect(() => scanBatchCount(-1)).toThrow();
  });
});
