import { describe, expect, it, vi } from 'vitest';
import type { ClockPort, IdPort } from '$lib/runtime/ports';
import { ResourceScope } from '$lib/runtime/resource-scope';
import {
  LOG_PROTOCOL_VERSION,
  MAX_ACTIVE_LOG_REQUESTS,
  MAX_LOG_ENTRIES,
  MAX_LOG_MESSAGE_IDS,
  MAX_LOG_REQUEST_IDS,
  type LogEntry
} from './contracts';
import { normalizeLogDetails } from './details';
import { createLoggingRuntime, type LogChannel } from './runtime';

class FakeIds implements IdPort {
  next = 0;
  create(): string { return `id-${++this.next}`; }
}

class FakeClock implements ClockPort {
  wallTime = 1000;
  monotonicTime = 0;
  microtasks: Array<() => void> = [];
  wallNow(): number { return ++this.wallTime; }
  monotonicNow(): number { return ++this.monotonicTime; }
  queueMicrotask(callback: () => void): void { this.microtasks.push(callback); }
  setTimeout(): unknown { return 1; }
  clearTimeout(): void {}
  setInterval(): unknown { return 1; }
  clearInterval(): void {}
  requestAnimationFrame(): unknown { return 1; }
  cancelAnimationFrame(): void {}
  flushMicrotasks(): void {
    for (const callback of this.microtasks.splice(0)) callback();
  }
}

function createHarness(options: {
  channel?: LogChannel;
  createChannel?: () => LogChannel;
  settings?: () => { captureDebug: boolean; mirrorToConsole: boolean };
  console?: { error(...values: unknown[]): void; warn(...values: unknown[]): void; info(...values: unknown[]): void; debug(...values: unknown[]): void };
} = {}) {
  const ids = new FakeIds();
  const clock = new FakeClock();
  const scope = new ResourceScope('logging test', clock, ids);
  const runtime = createLoggingRuntime({
    context: 'test',
    scope,
    clock,
    ids,
    channels: options.channel || options.createChannel
      ? { create: options.createChannel ?? (() => options.channel as LogChannel) }
      : undefined,
    settings: options.settings ?? (() => ({ captureDebug: true, mirrorToConsole: false })),
    console: options.console
  });
  runtime.init();
  return { clock, ids, runtime, scope };
}

describe('logging runtime', () => {
  it('keeps bounded own/history data, gates debug explicitly, and carries reusable correlation IDs', () => {
    let captureDebug = false;
    const { runtime } = createHarness({
      settings: () => ({ captureDebug, mirrorToConsole: false })
    });
    expect(runtime.log('debug', 'system', 'hidden')).toBeNull();
    captureDebug = true;
    const correlationId = runtime.createCorrelationId('import');
    for (let index = 0; index < MAX_LOG_ENTRIES + 5; index += 1) {
      runtime.log('debug', 'files', `entry ${index}`, undefined, { correlationId });
    }

    expect(runtime.getOwnEntries()).toHaveLength(MAX_LOG_ENTRIES);
    expect(runtime.getOwnEntries()[0]).toMatchObject({ message: 'entry 5', correlationId });
    expect(runtime.diagnostic()).toMatchObject({ ownEntries: MAX_LOG_ENTRIES });
  });

  it('normalizes circular, bigint, Error, deep, and hostile details without executing toJSON', () => {
    const toJSON = vi.fn(() => ({ escaped: true }));
    const circular: Record<string, unknown> = { count: 3n, error: new Error('boom'), toJSON };
    circular.self = circular;
    const normalized = normalizeLogDetails(circular);
    expect(normalized).toContain('"count":"3n"');
    expect(normalized).toContain('[Circular]');
    expect(normalized).toContain('boom');
    expect(toJSON).not.toHaveBeenCalled();

    const hostile = { toString: () => { throw new Error('nope'); } };
    Object.defineProperty(hostile, 'value', { enumerable: true, get: () => { throw new Error('nope'); } });
    expect(normalizeLogDetails(hostile)).toContain('[Thrown property accessor]');

    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    expect(() => normalizeLogDetails(revocable.proxy)).not.toThrow();
    expect(normalizeLogDetails({ values: new Array(500).fill('value') })?.length).toBeLessThanOrEqual(32768);
  });

  it('batches subscriber snapshots and isolates scheduler, subscriber, settings, and console failures', () => {
    const consolePort = {
      error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
      info: vi.fn(() => { throw new Error('console failed'); })
    };
    let settingsFail = false;
    const { clock, runtime } = createHarness({
      console: consolePort,
      settings: () => {
        if (settingsFail) throw new Error('settings failed');
        return { captureDebug: true, mirrorToConsole: true };
      }
    });
    const snapshots: LogEntry[][] = [];
    runtime.subscribe((entries) => snapshots.push(entries));
    runtime.subscribe(() => { throw new Error('subscriber failed'); });
    expect(() => runtime.log('info', 'system', 'one')).not.toThrow();
    expect(() => runtime.log('info', 'system', 'two')).not.toThrow();
    expect(clock.microtasks).toHaveLength(1);
    clock.flushMicrotasks();
    expect(snapshots.at(-1)?.map(({ message }) => message)).toEqual(['one', 'two']);

    settingsFail = true;
    expect(runtime.log('debug', 'system', 'debug falls back to disabled')).toBeNull();
    expect(consolePort.info).toHaveBeenCalledTimes(2);
  });

  it('bounds all duplicate-suppression sets under hostile message traffic', () => {
    let listener: ((event: MessageEvent<unknown>) => void) | undefined;
    const channel: LogChannel = {
      postMessage: vi.fn(),
      addEventListener: (_type, next) => { listener = next; },
      removeEventListener: vi.fn(),
      close: vi.fn()
    };
    const { runtime } = createHarness({ channel });
    const deliver = (data: unknown) => listener?.({ data } as MessageEvent<unknown>);

    for (let index = 0; index < MAX_LOG_MESSAGE_IDS + 50; index += 1) {
      deliver({ protocol: LOG_PROTOCOL_VERSION, type: 'unknown', messageId: `message-${index}`, originId: 'remote' });
    }
    for (let index = 0; index < MAX_LOG_REQUEST_IDS + 50; index += 1) {
      deliver({
        protocol: LOG_PROTOCOL_VERSION,
        type: 'history-request',
        messageId: `request-message-${index}`,
        originId: 'remote',
        requestId: `request-${index}`
      });
    }
    for (let index = 0; index < MAX_ACTIVE_LOG_REQUESTS + 10; index += 1) runtime.requestHistory();

    expect(runtime.diagnostic()).toMatchObject({
      seenMessageIds: MAX_LOG_MESSAGE_IDS,
      answeredRequestIds: MAX_LOG_REQUEST_IDS,
      activeRequestIds: MAX_ACTIVE_LOG_REQUESTS
    });
  });

  it('survives channel create/post failures and reports close failures through idempotent scope teardown', async () => {
    const creation = createHarness({ createChannel: () => { throw new Error('unavailable'); } });
    expect(() => creation.runtime.log('info', 'system', 'local only')).not.toThrow();
    expect(creation.runtime.getOwnEntries()).toHaveLength(1);
    expect(creation.runtime.diagnostic()).toMatchObject({ channelAvailable: false, transportFailures: 1 });

    const channel: LogChannel = {
      postMessage: () => { throw new Error('post failed'); },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: () => { throw new Error('close failed'); }
    };
    const { runtime } = createHarness({ channel });
    runtime.init();
    expect(() => runtime.log('info', 'system', 'still local')).not.toThrow();
    expect(runtime.diagnostic().transportFailures).toBe(1);

    const firstDestroy = runtime.destroy();
    const repeatedDestroy = runtime.destroy();
    expect(repeatedDestroy).toBe(firstDestroy);
    const report = await firstDestroy;
    expect(report.failures).toEqual([
      expect.objectContaining({ kind: 'broadcast-channel', label: 'test logging channel' })
    ]);
    expect(runtime.log('info', 'system', 'after destroy')).toBeNull();
    expect(runtime.diagnostic()).toMatchObject({ destroyed: true, seenMessageIds: 0, activeRequestIds: 0 });
  });
});

