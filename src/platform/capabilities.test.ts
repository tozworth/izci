import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import * as android from '../android/platform';

vi.mock('$platform', async () => await import('../android/platform'));
import { buildServerInviteLink } from '$lib/services/multiplayer-server-invite';

const pwa = await vi.importActual<typeof import('./pwa/platform')>('./pwa/platform');

afterEach(() => vi.unstubAllGlobals());

describe('explicit platform capabilities', () => {
  it('gives PWA and APK their own capabilities despite sharing the browser runtime', () => {
    expect(pwa.platformId).toBe('pwa');
    expect(pwa.platformCapabilities.serviceWorkerUpdates).toBe(true);
    expect(pwa.platformCapabilities.appInstallation).toBe(true);
    expect(pwa.platformCapabilities.windowControlsOverlay).toBe(true);
    expect(android.platformId).toBe('android');
    expect(android.platformCapabilities.serviceWorkerUpdates).toBe(false);
    expect(android.platformCapabilities.appInstallation).toBe(false);
    expect(android.platformCapabilities.windowControlsOverlay).toBe(false);
  });

  it('does not touch service workers, launchQueue, or install APIs in the APK', async () => {
    vi.stubGlobal('window', new Proxy({}, { get: () => { throw new Error('APK touched a PWA window API.'); } }));
    vi.stubGlobal('navigator', new Proxy({}, { get: () => { throw new Error('APK touched a PWA navigator API.'); } }));
    await android.registerAppServiceWorker();
    await android.checkServiceWorkerUpdate();
    await android.forceServiceWorkerUpdateCheck();
    await android.applyAvailableServiceWorkerUpdate();
    expect(android.consumeFileLaunchMarker()).toBe(false);
    expect(get(android.appInstallService)).toEqual({ available: false, showHint: false });
    expect(await android.appInstallService.prompt()).toBe('unavailable');
    expect(get(android.windowControlsOverlayState)).toMatchObject({ supported: false, visible: false });
    expect(get(android.pwaUpdateCheckState)).toEqual({ status: 'idle', lastSuccessfulCheck: null });
  });

  it('produces a usable invitation rather than sharing Android’s packaged origin', () => {
    vi.stubGlobal('window', { location: { origin: 'https://appassets.androidplatform.net' } });
    const link = buildServerInviteLink({ endpoint: 'https://signal.example.com', roomId: 'a'.repeat(32), secret: 'test-secret', title: null });
    expect(link).toMatch(/^https:\/\/izci\.xn--ala-hsa\.net\/#party=/);
  });
});
