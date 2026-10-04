import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { registerSW } = vi.hoisted(() => ({
  registerSW: vi.fn()
}));

vi.mock('virtual:pwa-register', () => ({ registerSW }));
vi.mock('$lib/services/logging', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarning: vi.fn()
}));

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, String(value));
  }
}

interface ServiceWorkerContainerDouble extends EventTarget {
  controller: object | null;
  getRegistration: ReturnType<typeof vi.fn>;
}

interface RegistrationDouble extends EventTarget {
  scope: string;
  installing: ServiceWorker | null;
  waiting: ServiceWorker | null;
  update: ReturnType<typeof vi.fn>;
}

interface WorkerDouble extends EventTarget {
  state: ServiceWorkerState;
  postMessage: ReturnType<typeof vi.fn>;
}

function worker(state: ServiceWorkerState): WorkerDouble {
  return Object.assign(new EventTarget(), {
    state,
    postMessage: vi.fn()
  });
}

function registration(overrides: Partial<RegistrationDouble> = {}): RegistrationDouble {
  return Object.assign(new EventTarget(), {
    scope: '/',
    installing: null,
    waiting: null,
    update: vi.fn(async () => undefined),
    ...overrides
  });
}

function installBrowserGlobals(options: {
  online?: boolean;
  registration?: RegistrationDouble | null;
  controlled?: boolean;
  visibility?: DocumentVisibilityState;
} = {}) {
  const container = Object.assign(new EventTarget(), {
    controller: options.controlled ? {} : null,
    getRegistration: vi.fn(async () => options.registration ?? null)
  }) as ServiceWorkerContainerDouble;
  const browserWindow = Object.assign(new EventTarget(), {
    location: {
      hostname: 'example.test',
      reload: vi.fn()
    },
    setTimeout,
    clearTimeout,
    setInterval
  });
  const browserDocument = Object.assign(new EventTarget(), {
    visibilityState: options.visibility ?? 'visible'
  });
  const browserNavigator = {
    onLine: options.online ?? true,
    serviceWorker: container
  };

  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', browserDocument);
  vi.stubGlobal('navigator', browserNavigator);

  return { browserDocument, browserNavigator, browserWindow, container };
}

async function loadUpdater() {
  return await import('./pwa-updates');
}

describe('PWA update decisions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T10:00:00.000Z'));
    registerSW.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fails a manual check while offline without consulting registration state', async () => {
    const { container } = installBrowserGlobals({ online: false });
    const updater = await loadUpdater();

    await updater.forceServiceWorkerUpdateCheck();

    expect(container.getRegistration).not.toHaveBeenCalled();
    expect(get(updater.pwaUpdateCheckState)).toEqual({
      status: 'failed',
      lastSuccessfulCheck: null
    });
    expect(get(updater.pwaUpdateStatus)).toBe('failed');
  });

  it('records an already-waiting worker as available after a successful online check', async () => {
    const waiting = worker('installed');
    const currentRegistration = registration({ waiting: waiting as unknown as ServiceWorker });
    installBrowserGlobals({ registration: currentRegistration });
    const updater = await loadUpdater();

    await updater.checkServiceWorkerUpdate();

    expect(currentRegistration.update).toHaveBeenCalledOnce();
    expect(get(updater.pwaUpdateCheckState)).toEqual({
      status: 'available',
      lastSuccessfulCheck: Date.now()
    });
    expect(get(updater.pwaUpdateStatus)).toBe('available');
  });

  it('keeps checking until a newly discovered worker finishes installing', async () => {
    const installing = worker('installing');
    const currentRegistration = registration();
    currentRegistration.update.mockImplementation(async () => {
      currentRegistration.installing = installing as unknown as ServiceWorker;
      currentRegistration.dispatchEvent(new Event('updatefound'));
    });
    installBrowserGlobals({ registration: currentRegistration });
    const updater = await loadUpdater();

    const checking = updater.checkServiceWorkerUpdate();
    await vi.waitFor(() => expect(currentRegistration.update).toHaveBeenCalledOnce());
    expect(get(updater.pwaUpdateCheckState).status).toBe('checking');
    expect(get(updater.pwaUpdateStatus)).toBe('checking');

    currentRegistration.installing = null;
    currentRegistration.waiting = installing as unknown as ServiceWorker;
    installing.state = 'installed';
    installing.dispatchEvent(new Event('statechange'));
    await checking;

    expect(get(updater.pwaUpdateCheckState).status).toBe('available');
    expect(get(updater.pwaUpdateStatus)).toBe('available');
  });

  it('reports up to date only after a real check finds no update', async () => {
    const currentRegistration = registration();
    const { browserWindow } = installBrowserGlobals({ registration: currentRegistration });
    const updater = await loadUpdater();

    await updater.forceServiceWorkerUpdateCheck();

    expect(currentRegistration.update).toHaveBeenCalledOnce();
    expect(get(updater.pwaUpdateCheckState)).toEqual({
      status: 'up-to-date',
      lastSuccessfulCheck: Date.now()
    });
    expect(get(updater.pwaUpdateStatus)).toBe('up-to-date');
    expect(browserWindow.location.reload).not.toHaveBeenCalled();
  });

  it('force applies an already-waiting update and reloads after it takes control', async () => {
    const waiting = worker('installed');
    const currentRegistration = registration({ waiting: waiting as unknown as ServiceWorker });
    const { browserWindow, container } = installBrowserGlobals({ registration: currentRegistration });
    const updater = await loadUpdater();

    const checking = updater.forceServiceWorkerUpdateCheck();
    await vi.waitFor(() => expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
    expect(browserWindow.location.reload).not.toHaveBeenCalled();
    expect(get(updater.pwaUpdateStatus)).toBe('updating');

    container.dispatchEvent(new Event('controllerchange'));
    await Promise.resolve();
    expect(browserWindow.location.reload).not.toHaveBeenCalled();

    container.controller = waiting;
    container.dispatchEvent(new Event('controllerchange'));
    await checking;

    expect(browserWindow.location.reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('izci.pwa-update-completed')).toBe('true');
  });

  it('force waits for precaching before activating a newly fetched update', async () => {
    const installing = worker('installing');
    const currentRegistration = registration();
    currentRegistration.update.mockImplementation(async () => {
      currentRegistration.installing = installing as unknown as ServiceWorker;
      currentRegistration.dispatchEvent(new Event('updatefound'));
    });
    const { browserWindow, container } = installBrowserGlobals({ registration: currentRegistration });
    installing.postMessage.mockImplementation(() => {
      container.controller = installing;
      container.dispatchEvent(new Event('controllerchange'));
    });
    const updater = await loadUpdater();

    const checking = updater.forceServiceWorkerUpdateCheck();
    await vi.waitFor(() => expect(currentRegistration.update).toHaveBeenCalledOnce());
    expect(installing.postMessage).not.toHaveBeenCalled();
    expect(browserWindow.location.reload).not.toHaveBeenCalled();
    expect(get(updater.pwaUpdateStatus)).toBe('updating');

    installing.state = 'installed';
    currentRegistration.installing = null;
    currentRegistration.waiting = installing as unknown as ServiceWorker;
    installing.dispatchEvent(new Event('statechange'));
    await checking;

    expect(installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(browserWindow.location.reload).toHaveBeenCalledOnce();
  });

  it('force waits for a worker that was already installing before the click', async () => {
    const installing = worker('installing');
    const currentRegistration = registration({ installing: installing as unknown as ServiceWorker });
    const { browserWindow, container } = installBrowserGlobals({ registration: currentRegistration });
    const updater = await loadUpdater();

    const checking = updater.forceServiceWorkerUpdateCheck();
    await vi.waitFor(() => expect(currentRegistration.update).toHaveBeenCalledOnce());
    expect(get(updater.pwaUpdateCheckState).status).toBe('checking');
    installing.state = 'activated';
    currentRegistration.installing = null;
    container.controller = installing;
    installing.dispatchEvent(new Event('statechange'));
    await checking;

    expect(installing.postMessage).not.toHaveBeenCalled();
    expect(browserWindow.location.reload).toHaveBeenCalledOnce();
    expect(get(updater.pwaUpdateStatus)).not.toBe('up-to-date');
  });

  it('force can check before the registerSW callback supplies the registration', async () => {
    const currentRegistration = registration();
    installBrowserGlobals({ registration: currentRegistration });
    const updater = await loadUpdater();
    await updater.registerAppServiceWorker();

    await updater.forceServiceWorkerUpdateCheck();

    expect(currentRegistration.update).toHaveBeenCalledOnce();
    expect(get(updater.pwaUpdateCheckState).status).toBe('up-to-date');
  });

  it('force awaits an in-flight background check instead of silently skipping', async () => {
    let finishUpdate!: () => void;
    const currentRegistration = registration({
      update: vi.fn(() => new Promise<void>((resolve) => { finishUpdate = resolve; }))
    });
    installBrowserGlobals({ registration: currentRegistration });
    registerSW.mockImplementation((options) => {
      options.onRegisteredSW?.('/sw.js', currentRegistration as unknown as ServiceWorkerRegistration);
    });
    const updater = await loadUpdater();
    await updater.registerAppServiceWorker();

    const checking = updater.forceServiceWorkerUpdateCheck();
    await Promise.resolve();
    expect(currentRegistration.update).toHaveBeenCalledOnce();
    expect(get(updater.pwaUpdateCheckState).status).toBe('checking');
    expect(get(updater.pwaUpdateCheckState).lastSuccessfulCheck).toBeNull();

    finishUpdate();
    await checking;
    expect(get(updater.pwaUpdateCheckState).status).toBe('up-to-date');
  });

  it('reports failure if a joined background check rejects', async () => {
    let failUpdate!: (error: Error) => void;
    const currentRegistration = registration({
      update: vi.fn(() => new Promise<void>((_resolve, reject) => { failUpdate = reject; }))
    });
    installBrowserGlobals({ registration: currentRegistration });
    registerSW.mockImplementation((options) => {
      options.onRegisteredSW?.('/sw.js', currentRegistration as unknown as ServiceWorkerRegistration);
    });
    const updater = await loadUpdater();
    await updater.registerAppServiceWorker();
    const checking = updater.forceServiceWorkerUpdateCheck();
    await Promise.resolve();

    failUpdate(new Error('network failed'));
    await checking;

    expect(get(updater.pwaUpdateCheckState)).toEqual({ status: 'failed', lastSuccessfulCheck: null });
    expect(get(updater.pwaUpdateStatus)).toBe('failed');
  });

  it('does not claim success or reload when installation fails', async () => {
    const installing = worker('installing');
    const currentRegistration = registration({ installing: installing as unknown as ServiceWorker });
    const { browserWindow } = installBrowserGlobals({ registration: currentRegistration });
    const updater = await loadUpdater();
    const checking = updater.forceServiceWorkerUpdateCheck();
    await vi.waitFor(() => expect(currentRegistration.update).toHaveBeenCalledOnce());

    installing.state = 'redundant';
    installing.dispatchEvent(new Event('statechange'));
    await checking;

    expect(get(updater.pwaUpdateCheckState)).toEqual({ status: 'failed', lastSuccessfulCheck: null });
    expect(browserWindow.location.reload).not.toHaveBeenCalled();
  });

  it('fails a stalled installation and removes its state listener', async () => {
    const installing = worker('installing');
    const removeListener = vi.spyOn(installing, 'removeEventListener');
    const currentRegistration = registration({ installing: installing as unknown as ServiceWorker });
    const { browserWindow } = installBrowserGlobals({ registration: currentRegistration });
    const updater = await loadUpdater();
    const checking = updater.forceServiceWorkerUpdateCheck();
    await vi.waitFor(() => expect(currentRegistration.update).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(60_000);
    await checking;

    expect(get(updater.pwaUpdateCheckState).status).toBe('failed');
    expect(browserWindow.location.reload).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('statechange', expect.any(Function));
  });

  it('fails activation without reloading the old app or leaving a controller listener', async () => {
    const waiting = worker('installed');
    const currentRegistration = registration({ waiting: waiting as unknown as ServiceWorker });
    const { browserWindow, container } = installBrowserGlobals({ registration: currentRegistration });
    const removeListener = vi.spyOn(container, 'removeEventListener');
    const updater = await loadUpdater();
    const checking = updater.forceServiceWorkerUpdateCheck();
    await vi.waitFor(() => expect(waiting.postMessage).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(60_000);
    await checking;

    expect(get(updater.pwaUpdateCheckState).status).toBe('failed');
    expect(browserWindow.location.reload).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
  });

  it('retains the last successful timestamp when an online update call fails', async () => {
    const currentRegistration = registration();
    currentRegistration.update.mockRejectedValue(new Error('network failed'));
    installBrowserGlobals({ registration: currentRegistration });
    localStorage.setItem('izci.pwa-update-last-successful-check', '1234');
    const updater = await loadUpdater();

    await updater.forceServiceWorkerUpdateCheck();

    expect(get(updater.pwaUpdateCheckState)).toEqual({
      status: 'failed',
      lastSuccessfulCheck: 1234
    });
    expect(get(updater.pwaUpdateStatus)).toBe('failed');
  });

  it('defers background checks offline and retries when the online event arrives', async () => {
    const currentRegistration = registration();
    const { browserNavigator, browserWindow } = installBrowserGlobals({
      online: false,
      registration: currentRegistration
    });
    registerSW.mockImplementation((options) => {
      options.onRegisteredSW?.('/sw.js', currentRegistration as unknown as ServiceWorkerRegistration);
      return vi.fn();
    });
    const updater = await loadUpdater();

    await updater.registerAppServiceWorker();
    await Promise.resolve();
    expect(currentRegistration.update).not.toHaveBeenCalled();

    browserNavigator.onLine = true;
    browserWindow.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(currentRegistration.update).toHaveBeenCalledOnce());
  });

  it('marks apply as failed and does not reload when registration is absent', async () => {
    const { browserWindow } = installBrowserGlobals();
    const updater = await loadUpdater();

    await updater.applyAvailableServiceWorkerUpdate();

    expect(get(updater.pwaUpdateCheckState).status).toBe('failed');
    expect(browserWindow.location.reload).not.toHaveBeenCalled();
  });

  it('waits for installation, asks the waiting worker to activate, then reloads', async () => {
    const installing = worker('installing');
    const waiting = worker('installed');
    const currentRegistration = registration({
      installing: installing as unknown as ServiceWorker,
      waiting: waiting as unknown as ServiceWorker
    });
    const { browserWindow, container } = installBrowserGlobals({ registration: currentRegistration });
    waiting.postMessage.mockImplementation(() => {
      queueMicrotask(() => {
        container.controller = waiting;
        container.dispatchEvent(new Event('controllerchange'));
      });
    });
    const updater = await loadUpdater();

    const applying = updater.applyAvailableServiceWorkerUpdate();
    await Promise.resolve();
    expect(waiting.postMessage).not.toHaveBeenCalled();

    installing.state = 'installed';
    installing.dispatchEvent(new Event('statechange'));
    await applying;

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(browserWindow.location.reload).toHaveBeenCalledOnce();
  });

  it('reloads immediately when apply finds no installing or waiting worker', async () => {
    const currentRegistration = registration();
    const { browserWindow } = installBrowserGlobals({ registration: currentRegistration });
    const updater = await loadUpdater();

    await updater.applyAvailableServiceWorkerUpdate();

    expect(browserWindow.location.reload).toHaveBeenCalledOnce();
  });
});
