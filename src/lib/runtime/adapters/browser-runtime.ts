import { createPageRuntime, type PageRuntime } from '../page-runtime';
import { BrowserCapabilities } from './browser-capabilities';
import { BrowserClock } from './browser-clock';
import { BrowserFileAccess, type FileAccessWindow } from './browser-file-access';
import { BrowserId } from './browser-id';
import { BrowserAbortControllers, BrowserBroadcastChannels, BrowserObjectUrls } from './browser-resources';
import { BrowserKeyValueStorage } from './browser-storage';
import { BrowserWorkerPort } from './browser-worker';

export function createBrowserRuntime(
  label: string,
  target: Window & typeof globalThis & FileAccessWindow = window,
  cryptoSource: Crypto = crypto
): PageRuntime {
  return createPageRuntime(label, {
    clock: new BrowserClock(target, () => target.Date.now(), () => target.performance.now()),
    ids: new BrowserId(cryptoSource),
    capabilities: new BrowserCapabilities(target),
    storage: new BrowserKeyValueStorage(() => target.localStorage, target),
    files: new BrowserFileAccess(target),
    workers: new BrowserWorkerPort(),
    abortControllers: new BrowserAbortControllers(target),
    broadcastChannels: new BrowserBroadcastChannels(target),
    objectUrls: new BrowserObjectUrls(target)
  });
}
