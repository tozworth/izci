/// <reference lib="webworker" />
import { validateDocumentMessage } from './profile-protocol';
import { validateProfileName } from './profile-names';

/**
 * Stub Svelte profile owner worker (validating-only, no storage yet).
 *
 * This is the first worker file of the A2 live-owner slice. It owns no
 * OPFS/SQLite, WebProfile, locks, or channels yet — it only validates the
 * document envelope via `profile-protocol.ts` and profile names via
 * `profile-names.ts`, then replies with stub `profile-ready`/`result`/
 * `error` messages. Real `openDatabase`/`WebProfile`/`Capabilities`/owner
 * election land in later slices (they need the `@sqlite.org/sqlite-wasm`
 * dependency, which the main app does not have yet).
 *
 * Nothing here touches storage, handles, or audio.
 */

export interface StubWorkerInit {
  type: 'profile-init';
  name: string;
  request?: string;
}

self.onmessage = (event: MessageEvent<{ type: string; [key: string]: unknown }>) => {
  const message = event.data;
  try {
    validateDocumentMessage(message);
  } catch (error) {
    self.postMessage({ type: 'error', detail: String(error) });
    return;
  }
  if (message.type === 'profile-init') {
    try {
      validateProfileName((message as unknown as StubWorkerInit).name);
    } catch (error) {
      self.postMessage({ type: 'profile-failed', error: String(error) });
      return;
    }
    self.postMessage({ type: 'profile-ready' });
    return;
  }
  if (message.type === 'close') {
    self.postMessage({ type: 'result', request: (message as { request?: string }).request ?? null, value: null });
    return;
  }
  if (message.type === 'ack') {
    return;
  }
  self.postMessage({
    type: 'result',
    request: (message as { request?: string }).request ?? null,
    error: 'not-implemented: profile storage lands in the next slice'
  });
};
