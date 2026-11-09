import { validateProfileName } from './profile-names';

/**
 * Spawn the stub Svelte profile owner worker.
 *
 * Validates the profile name first (fresh `izci-v1` namespace, never the
 * crude names), then constructs the worker through the single generated
 * import site pattern (`new URL(..., import.meta.url)` inline so Vite emits
 * the chunk). The worker currently only validates envelopes and answers
 * `profile-init`/`close`/`ack`; storage and execution land in later slices.
 */

export interface ProfileOwnerHandle {
  readonly worker: Worker;
  readonly name: string;
}

export function spawnProfileOwnerWorker(name: string): ProfileOwnerHandle {
  validateProfileName(name);
  // Keep the `new URL(..., import.meta.url)` inline so Vite still emits the
  // worker chunk for this call site.
  const worker = new Worker(new URL('./profile-owner.worker.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ type: 'profile-init', name });
  return { worker, name };
}
