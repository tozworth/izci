import { describe, expect, it, vi } from 'vitest';
import { createAppInstallService } from './app-install';

function createWindowStub() {
  const events = new EventTarget();
  const storage = new Map<string, string>();
  return {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    }
  } as unknown as Window;
}

function installPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

describe('app install service', () => {
  it('offers installation immediately but delays the hint until meaningful engagement', () => {
    const targetWindow = createWindowStub();
    const service = createAppInstallService({ window: targetWindow, isInstalled: () => false });
    const snapshots: Array<{ available: boolean; showHint: boolean }> = [];
    service.subscribe((value) => snapshots.push(value));

    targetWindow.dispatchEvent(installPromptEvent());
    expect(snapshots.at(-1)).toEqual({ available: true, showHint: false });

    service.markEngaged();
    expect(snapshots.at(-1)).toEqual({ available: true, showHint: true });
    service.destroy();
  });

  it('permanently quiets the hint while retaining the install action', () => {
    const targetWindow = createWindowStub();
    const service = createAppInstallService({ window: targetWindow, isInstalled: () => false });
    let snapshot = { available: false, showHint: false };
    service.subscribe((value) => (snapshot = value));
    targetWindow.dispatchEvent(installPromptEvent());
    service.markEngaged();
    service.acknowledgeHint();

    expect(snapshot).toEqual({ available: true, showHint: false });

    service.destroy();
    const nextService = createAppInstallService({ window: targetWindow, isInstalled: () => false });
    nextService.subscribe((value) => (snapshot = value));
    targetWindow.dispatchEvent(installPromptEvent());
    nextService.markEngaged();
    expect(snapshot).toEqual({ available: true, showHint: false });
    nextService.destroy();
  });

  it('consumes the deferred prompt and hides the action', async () => {
    const targetWindow = createWindowStub();
    const event = installPromptEvent('dismissed');
    const service = createAppInstallService({ window: targetWindow, isInstalled: () => false });
    let available = false;
    service.subscribe((value) => (available = value.available));
    targetWindow.dispatchEvent(event);

    await expect(service.prompt()).resolves.toBe('dismissed');
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(available).toBe(false);
    service.destroy();
  });
});
