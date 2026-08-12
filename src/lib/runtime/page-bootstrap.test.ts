import { describe, expect, it, vi } from 'vitest';
import type { PageRuntime } from './page-runtime';
import type {
  AbortControllerPort,
  BroadcastChannelPort,
  CapabilityPort,
  ClockPort,
  FileAccessPort,
  IdPort,
  KeyValueStoragePort,
  ObjectUrlPort,
  WorkerPort
} from './ports';
import { ResourceScope } from './resource-scope';
import {
  bootstrapPage,
  type PageBootstrapConfig,
  type PageHideEventPort,
  type PageHideListener,
  type PageInitializer,
  type PageLifecycleTargetPort
} from './page-bootstrap';

class FakeIds implements IdPort {
  #next = 0;
  create(): string { return `page-${++this.#next}`; }
}

class FakeClock implements ClockPort {
  now = 0;
  wallNow(): number { return ++this.now; }
  monotonicNow(): number { return ++this.now; }
  queueMicrotask(callback: () => void): void { callback(); }
  setTimeout(): unknown { return 1; }
  clearTimeout(): void {}
  setInterval(): unknown { return 1; }
  clearInterval(): void {}
  requestAnimationFrame(): unknown { return 1; }
  cancelAnimationFrame(): void {}
}

class FakeLifecycle implements PageLifecycleTargetPort {
  listeners = new Set<PageHideListener>();
  addEventListener(_type: 'pagehide', listener: PageHideListener): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'pagehide', listener: PageHideListener): void {
    this.listeners.delete(listener);
  }
  pagehide(persisted: boolean): void {
    const event: PageHideEventPort = { persisted };
    for (const listener of [...this.listeners]) listener(event);
  }
}

function fakeRuntime(): PageRuntime {
  const clock = new FakeClock();
  const unavailable = () => { throw new Error('unused test port'); };
  return {
    clock,
    ids: new FakeIds(),
    capabilities: { has: () => false } satisfies CapabilityPort,
    storage: {
      read: () => null,
      write: unavailable,
      remove: unavailable,
      subscribe: () => () => undefined
    } satisfies KeyValueStoragePort,
    files: {
      openFiles: unavailable,
      openDirectory: unavailable,
      saveFile: unavailable
    } as unknown as FileAccessPort,
    workers: { create: unavailable } as unknown as WorkerPort,
    abortControllers: { create: unavailable } as unknown as AbortControllerPort,
    broadcastChannels: { create: unavailable } as unknown as BroadcastChannelPort,
    objectUrls: { create: unavailable, revoke: unavailable } as unknown as ObjectUrlPort,
    scope: new ResourceScope('test page', clock, new FakeIds())
  };
}

function recordedHook(name: string, calls: string[], cleanup?: () => void): PageInitializer {
  return (runtime) => {
    expect(runtime.scope.label).toBe('test page');
    calls.push(name);
    return cleanup;
  };
}

function config(
  overrides: Partial<PageBootstrapConfig> = {},
  calls: string[] = []
): PageBootstrapConfig {
  return {
    pageId: 'options',
    runtime: fakeRuntime(),
    lifecycle: new FakeLifecycle(),
    production: true,
    logger: recordedHook('logger', calls),
    serviceWorker: recordedHook('service-worker', calls),
    theme: recordedHook('theme', calls),
    mobileDocument: recordedHook('mobile-document', calls),
    scrollbar: recordedHook('scrollbar', calls),
    localization: recordedHook('localization', calls),
    popupOrphan: recordedHook('popup-orphan', calls),
    mount: recordedHook('mount', calls),
    readiness: recordedHook('readiness', calls),
    marker: recordedHook('marker', calls),
    ...overrides
  };
}

describe('page bootstrap', () => {
  it('runs the frozen production initialization order and reaches readiness', async () => {
    const calls: string[] = [];
    const page = bootstrapPage(config({}, calls));

    await expect(page.readiness).resolves.toEqual({ status: 'ready', pageId: 'options' });
    expect(calls).toEqual([
      'logger',
      'service-worker',
      'theme',
      'mobile-document',
      'scrollbar',
      'localization',
      'popup-orphan',
      'mount',
      'readiness',
      'marker'
    ]);
  });

  it('skips service-worker and optional page capabilities when absent', async () => {
    const calls: string[] = [];
    const page = bootstrapPage(config({
      production: false,
      mobileDocument: undefined,
      popupOrphan: undefined
    }, calls));

    await expect(page.readiness).resolves.toMatchObject({ status: 'ready' });
    expect(calls).toEqual([
      'logger', 'theme', 'scrollbar', 'localization', 'mount', 'readiness', 'marker'
    ]);
  });

  it('captures a partial initialization failure and releases acquired effects', async () => {
    const calls: string[] = [];
    const releaseLogger = vi.fn(() => { calls.push('release-logger'); });
    const runtime = fakeRuntime();
    const page = bootstrapPage(config({
      runtime,
      logger: recordedHook('logger', calls, releaseLogger),
      theme: () => { calls.push('theme'); throw new Error('theme exploded'); }
    }, calls));

    const result = await page.readiness;
    expect(result).toMatchObject({
      status: 'failed',
      pageId: 'options',
      phase: 'theme',
      error: {
        category: 'internal',
        code: 'page-bootstrap.initialization-failed',
        operation: 'bootstrap options theme'
      },
      disposal: { failures: [] }
    });
    expect(calls).toEqual(['logger', 'service-worker', 'theme', 'release-logger']);
    expect(releaseLogger).toHaveBeenCalledOnce();
    expect(runtime.scope.diagnostic().state).toBe('disposed');
  });

  it('returns the same disposal promise and runs every cleanup once on repeated destroy', async () => {
    const unmount = vi.fn();
    const lifecycle = new FakeLifecycle();
    const runtime = fakeRuntime();
    const page = bootstrapPage(config({
      runtime,
      lifecycle,
      mount: () => unmount
    }));
    await page.readiness;

    const first = page.destroy();
    const second = page.destroy();
    expect(second).toBe(first);
    const firstReport = await first;
    expect(await second).toBe(firstReport);
    expect(unmount).toHaveBeenCalledOnce();
    expect(lifecycle.listeners).toHaveLength(0);
  });

  it('unmounts and disposes exactly once on non-BFCache pagehide', async () => {
    const unmount = vi.fn();
    const lifecycle = new FakeLifecycle();
    const runtime = fakeRuntime();
    const page = bootstrapPage(config({ runtime, lifecycle, mount: () => unmount }));
    await page.readiness;

    lifecycle.pagehide(false);
    lifecycle.pagehide(false);
    await page.destroy();

    expect(unmount).toHaveBeenCalledOnce();
    expect(runtime.scope.diagnostic().state).toBe('disposed');
  });

  it('retains the mounted page and root scope across persisted BFCache pagehide', async () => {
    const unmount = vi.fn();
    const lifecycle = new FakeLifecycle();
    const runtime = fakeRuntime();
    const page = bootstrapPage(config({ runtime, lifecycle, mount: () => unmount }));
    await page.readiness;

    lifecycle.pagehide(true);
    await Promise.resolve();

    expect(unmount).not.toHaveBeenCalled();
    expect(runtime.scope.diagnostic().state).toBe('active');
    expect(lifecycle.listeners).toHaveLength(1);
  });

  it('reports asynchronous readiness failure and does not invoke the marker', async () => {
    const marker = vi.fn();
    const runtime = fakeRuntime();
    const page = bootstrapPage(config({
      runtime,
      readiness: async () => { throw new Error('collections unavailable'); },
      marker
    }));

    await expect(page.readiness).resolves.toMatchObject({
      status: 'failed',
      phase: 'readiness',
      error: { code: 'page-bootstrap.initialization-failed' }
    });
    expect(marker).not.toHaveBeenCalled();
    expect(runtime.scope.diagnostic().state).toBe('disposed');
  });

  it('does not invoke the readiness marker after destruction during readiness', async () => {
    let finishReadiness!: () => void;
    const pendingReadiness = new Promise<void>((resolve) => { finishReadiness = resolve; });
    const marker = vi.fn();
    const runtime = fakeRuntime();
    const page = bootstrapPage(config({
      runtime,
      readiness: () => pendingReadiness,
      marker
    }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const disposal = page.destroy();
    finishReadiness();

    await disposal;
    await expect(page.readiness).resolves.toMatchObject({ status: 'destroyed' });
    expect(marker).not.toHaveBeenCalled();
  });
});
