import { describe, expect, it } from 'vitest';
import { makeDurableRequestId, validateDurableRequestId, validateRequestAge } from './durable-request';

describe('durable request ids', () => {
  it('builds revision-prefixed ids', () => {
    const id = makeDurableRequestId(41, 'queue');
    expect(id.startsWith('41:')).toBe(true);
    expect(id.endsWith('/queue')).toBe(true);
    expect(() => validateDurableRequestId(id)).not.toThrow();
    expect(() => makeDurableRequestId(-1, 'queue')).toThrow();
  });

  it('enforces the core 128-revision receipt window', () => {
    expect(() => validateRequestAge('40:abc/queue', 41)).not.toThrow();
    // No prefix passes (no replay protection, but not expired).
    expect(() => validateRequestAge('abc-uuid/queue', 500)).not.toThrow();
    expect(() => validateRequestAge('42:abc/queue', 41)).toThrow('request-expired');
    expect(() => validateRequestAge('0:abc/queue', 129)).toThrow('request-expired');
    expect(() => validateRequestAge('0:abc/queue', 128)).not.toThrow();
    expect(() => validateRequestAge('', 41)).toThrow();
  });
});
