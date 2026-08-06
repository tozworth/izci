import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLogs,
  getLogEntries,
  log,
  logDebug,
  logError,
  logInfo,
  logWarning,
  LOG_LEVELS,
  MAX_LOG_ENTRIES,
  subscribeLogs,
  type LogEntry
} from './logging';

beforeEach(() => {
  clearLogs();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearLogs();
});

describe('logging basics', () => {
  it('creates entries with level, source, message and a window-scoped id', () => {
    const entry = log('info', 'playback', 'Track loaded', { trackId: 'abc' });

    expect(entry).toMatchObject({
      level: 'info',
      source: 'playback',
      message: 'Track loaded',
      details: '{"trackId":"abc"}'
    });
    expect(typeof entry.id).toBe('string');
    expect(entry.id).toMatch(/:[0-9a-z]+:\d+$/);
    expect(typeof entry.timestamp).toBe('number');
    expect(getLogEntries()).toHaveLength(1);
  });

  it('offers per-level helpers', () => {
    expect(logError('decode', 'boom').level).toBe('error');
    expect(logWarning('files', 'slow').level).toBe('warning');
    expect(logInfo('library', 'loaded').level).toBe('info');
    expect(logDebug('system', 'detail').level).toBe('debug');
    expect(LOG_LEVELS).toEqual(['error', 'warning', 'info', 'debug']);
  });

  it('normalizes details to strings and omits absent details', () => {
    expect(log('info', 'system', 'no details').details).toBeUndefined();
    expect(log('info', 'system', 'string details', 'raw').details).toBe('raw');

    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    expect(log('info', 'system', 'circular', circular).details).toBe('[object Object]');
  });

  it('keeps entries in order and honors the ring buffer cap', () => {
    for (let index = 0; index < MAX_LOG_ENTRIES + 5; index += 1) {
      log('debug', 'system', `entry ${index}`);
    }

    const entries = getLogEntries();
    expect(entries).toHaveLength(MAX_LOG_ENTRIES);
    expect(entries[0].message).toBe('entry 5');
    expect(entries[entries.length - 1].message).toBe(`entry ${MAX_LOG_ENTRIES + 4}`);
  });

  it('clears the local buffer', () => {
    log('warning', 'files', 'something');
    clearLogs();
    expect(getLogEntries()).toHaveLength(0);
  });

  it('notifies subscribers with snapshots and unsubscribes', () => {
    const received: LogEntry[][] = [];
    const unsubscribe = subscribeLogs((list) => received.push(list));
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(0);

    log('info', 'playback', 'first');
    expect(received).toHaveLength(2);
    expect(received[1]).toHaveLength(1);

    unsubscribe();
    log('info', 'playback', 'second');
    expect(received).toHaveLength(2);
  });
});

describe('global error capture', () => {
  it('ignores benign ResizeObserver loop errors but logs real uncaught errors', async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    (globalThis as Record<string, unknown>).window = {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners.set(type, listener);
      }
    };

    try {
      vi.resetModules();
      const fresh = await import('./logging');
      fresh.initLogging();

      const fireError = (message: string, lineno = 0): void => {
        listeners.get('error')?.({
          message,
          filename: 'http://localhost:4173/logs.html',
          lineno,
          colno: 0
        } as ErrorEvent);
      };

      fireError('ResizeObserver loop completed with undelivered notifications.');
      fireError('ResizeObserver loop limit exceeded');
      expect(fresh.getLogEntries().filter((entry) => entry.message === 'Uncaught error')).toHaveLength(0);

      fireError('Something actually broke', 42);
      const captured = fresh.getLogEntries().filter((entry) => entry.message === 'Uncaught error');
      expect(captured).toHaveLength(1);
      expect(captured[0].details).toContain('Something actually broke');
    } finally {
      (globalThis as Record<string, unknown>).window = undefined;
      vi.resetModules();
    }
  });
});
