import { describe, expect, it } from 'vitest';
import { DomainError, classifyError, safeErrorCause, toDomainError } from './errors';

describe('runtime domain errors', () => {
  it.each([
    ['AbortError', 'cancellation', false],
    ['NotAllowedError', 'permission', true],
    ['QuotaExceededError', 'quota', true],
    ['NotSupportedError', 'unavailable', false],
    ['TimeoutError', 'timeout', true],
    ['InvalidStateError', 'blocked', true],
    ['DataError', 'corruption', false],
    ['NotReadableError', 'io', true]
  ] as const)('classifies %s without collapsing its category', (name, category, retryable) => {
    expect(classifyError({ name, message: 'failure' })).toEqual({ category, retryable });
  });

  it('preserves an existing domain error across boundaries', () => {
    const error = new DomainError({
      category: 'conflict',
      code: 'catalog.revision-conflict',
      operation: 'apply folder plan',
      retryable: true
    });
    expect(toDomainError(error, 'outer operation')).toBe(error);
  });

  it('retains only safe scalar cause details', () => {
    const cause = { name: 'Oops', message: 'failed', code: 9, secret: { token: 'nope' } };
    expect(safeErrorCause(cause)).toEqual({ name: 'Oops', message: 'failed', code: 9 });
    expect(JSON.stringify(new DomainError({
      category: 'internal', code: 'test.failed', operation: 'test', retryable: false, cause
    }).safeCause)).not.toContain('token');
  });
});
