import { describe, expect, it, vi } from 'vitest';
import {
  createLoggingRuntime,
  MAX_LOG_ENTRIES,
  normalizeLogDetails,
  type LogEntry
} from './logging';

const enabledSettings = () => ({ captureDebug: true, mirrorToConsole: false });

describe('logging runtime', () => {
  it('keeps a bounded own-context ring and gates debug capture', () => {
    const runtime = createLoggingRuntime({ context: 'test', instanceId: 'one', channelFactory: () => null });
    expect(runtime.log('debug', 'system', 'hidden')).toBeNull();

    const debugRuntime = createLoggingRuntime({
      context: 'test', instanceId: 'two', channelFactory: () => null, settings: enabledSettings
    });
    for (let index = 0; index < MAX_LOG_ENTRIES + 5; index += 1) {
      debugRuntime.log('debug', 'system', `entry ${index}`);
    }
    expect(debugRuntime.getOwnEntries()).toHaveLength(MAX_LOG_ENTRIES);
    expect(debugRuntime.getOwnEntries()[0].message).toBe('entry 5');
  });

  it('normalizes circular, bigint, Error, and hostile details without throwing', () => {
    const circular: Record<string, unknown> = { count: 3n, error: new Error('boom') };
    circular.self = circular;
    expect(normalizeLogDetails(circular)).toContain('"count":"3n"');
    expect(normalizeLogDetails(circular)).toContain('[Circular]');
    expect(normalizeLogDetails(circular)).toContain('boom');

    const hostile = { toString: () => { throw new Error('nope'); } };
    Object.defineProperty(hostile, 'value', { enumerable: true, get: () => { throw new Error('nope'); } });
    expect(() => normalizeLogDetails(hostile)).not.toThrow();
  });

  it('works without BroadcastChannel and batches subscriber snapshots', () => {
    const scheduled: Array<() => void> = [];
    const runtime = createLoggingRuntime({
      context: 'offline', instanceId: 'offline', channelFactory: () => null,
      scheduleNotification: (callback) => scheduled.push(callback), settings: enabledSettings
    });
    const snapshots: LogEntry[][] = [];
    runtime.subscribe((entries) => snapshots.push(entries));
    runtime.log('info', 'system', 'one');
    runtime.log('info', 'system', 'two');
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(snapshots.at(-1)?.map((entry) => entry.message)).toEqual(['one', 'two']);
  });

  it('isolates subscriber and console failures', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('console failed'); });
    const runtime = createLoggingRuntime({
      context: 'test', instanceId: 'faults', channelFactory: () => null,
      settings: () => ({ captureDebug: true, mirrorToConsole: true })
    });
    expect(() => runtime.log('info', 'system', 'safe')).not.toThrow();
    runtime.subscribe(() => { throw new Error('listener failed'); });
    expect(runtime.getEntries()).toHaveLength(1);
    info.mockRestore();
  });

  it('captures global failures while filtering benign ResizeObserver errors', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type)
    };
    try {
      const runtime = createLoggingRuntime({ context: 'errors', instanceId: 'errors', channelFactory: () => null });
      runtime.init();
      listeners.get('error')?.({ message: 'ResizeObserver loop limit exceeded' });
      listeners.get('error')?.({ message: 'Real failure', filename: 'app.js', lineno: 4, colno: 2 });
      listeners.get('unhandledrejection')?.({ reason: new Error('Rejected') });
      expect(runtime.getOwnEntries().filter((entry) => entry.message === 'Uncaught error')).toHaveLength(1);
      expect(runtime.getOwnEntries().some((entry) => entry.message === 'Unhandled promise rejection')).toBe(true);
      runtime.destroy();
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });
});
