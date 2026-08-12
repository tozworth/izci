import { describe, expect, it, vi } from 'vitest';
import type { BroadcastChannelPort, ClockPort, IdPort } from '$lib/runtime/ports';
import { ResourceScope } from '$lib/runtime/resource-scope';
import { getLogEntries, getLoggingRuntime } from './api';
import { initializeLogging, type LoggingPageTarget } from './initialize';

class FakeIds implements IdPort {
  next = 0;
  create(): string { return `page-${++this.next}`; }
}

class FakeClock implements ClockPort {
  time = 0;
  wallNow(): number { return 1000 + ++this.time; }
  monotonicNow(): number { return ++this.time; }
  queueMicrotask(callback: () => void): void { callback(); }
  setTimeout(): unknown { return 1; }
  clearTimeout(): void {}
  setInterval(): unknown { return 1; }
  clearInterval(): void {}
  requestAnimationFrame(): unknown { return 1; }
  cancelAnimationFrame(): void {}
}

class FakePageTarget extends EventTarget implements LoggingPageTarget {
  readonly console = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  readonly navigator = { platform: 'test-platform' };
}

function pageHarness() {
  const ids = new FakeIds();
  const clock = new FakeClock();
  const scope = new ResourceScope('page', clock, ids);
  const close = vi.fn();
  const broadcastChannels: BroadcastChannelPort = {
    create: () => ({
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close
    } as unknown as BroadcastChannel)
  };
  return { broadcastChannels, clock, close, ids, scope };
}

describe('page logging initialization', () => {
  it('is idempotent per page, captures global failures, and filters benign ResizeObserver errors', async () => {
    const page = pageHarness();
    const target = new FakePageTarget();
    const first = initializeLogging({
      runtime: page,
      context: 'main',
      target,
      version: 'test-version',
      settings: () => ({ captureDebug: true, mirrorToConsole: false })
    });
    const repeated = initializeLogging({
      runtime: page,
      context: 'main',
      target,
      settings: () => ({ captureDebug: true, mirrorToConsole: false })
    });
    expect(repeated).toBe(first);
    expect(page.scope.diagnostic().resources.filter(({ kind }) => kind === 'child-scope')).toHaveLength(1);

    target.dispatchEvent(Object.assign(new Event('error'), { message: 'ResizeObserver loop limit exceeded' }));
    target.dispatchEvent(Object.assign(new Event('error'), { message: 'real failure', filename: 'app.js' }));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('rejected') }));
    expect(getLogEntries().filter(({ message }) => message === 'Uncaught error')).toHaveLength(1);
    expect(getLogEntries().some(({ message }) => message === 'Unhandled promise rejection')).toBe(true);

    await first.destroy();
    expect(page.close).toHaveBeenCalledOnce();
    expect(getLoggingRuntime()).toBeUndefined();
  });

  it('tears down the installed API, listeners, and channel when the root resource scope is disposed', async () => {
    const page = pageHarness();
    const target = new FakePageTarget();
    const remove = vi.spyOn(target, 'removeEventListener');
    const initialized = initializeLogging({
      runtime: page,
      context: 'editor',
      target,
      settings: () => ({ captureDebug: false, mirrorToConsole: false })
    });

    const report = await page.scope.dispose();
    expect(report.failures).toEqual([]);
    expect(initialized.runtime.diagnostic().destroyed).toBe(true);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(page.close).toHaveBeenCalledOnce();
    expect(getLoggingRuntime()).toBeUndefined();
    expect(await initialized.destroy()).toBe(await initialized.destroy());
  });

  it('can initialize a fresh logging lifetime after explicit destroy while the page remains active', async () => {
    const page = pageHarness();
    const first = initializeLogging({ runtime: page, context: 'logs' });
    await first.destroy();
    const second = initializeLogging({ runtime: page, context: 'logs' });
    expect(second).not.toBe(first);
    expect(getLoggingRuntime()).toBe(second.runtime);
    await second.destroy();
  });
});

