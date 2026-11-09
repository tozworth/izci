import { isAccessGranted } from './access-status';

/**
 * Svelte-side boundary for transport command guards.
 *
 * The owner worker gates transport on access (see the crude `engine-worker`
 * `command` handler): `play` restores first unless granted, `pause`/`stop`/
 * `dispose` always run, and every other transport command requires granted
 * access. Queue navigation (`next` on empty, checkpoints) stays in the
 * queue/command layer; this module only decides whether a transport command
 * may be issued and whether a restore must precede it.
 *
 * Nothing here posts messages, resolves files, or starts audio.
 */

export type TransportCommandKind =
  | 'play'
  | 'pause'
  | 'stop'
  | 'seek'
  | 'subsong'
  | 'volume'
  | 'mute'
  | 'dispose';

const ALWAYS_ALLOWED: ReadonlySet<string> = new Set(['pause', 'stop', 'dispose']);

export interface TransportGuard {
  allowed: boolean;
  /** True when the caller must restore/materialize before issuing the command. */
  restoreFirst: boolean;
  reason?: string;
}

/**
 * Decide whether a transport command may be issued for the current access.
 * `play` is always allowed but requests a restore first unless granted;
 * `pause`/`stop`/`dispose` are always allowed with no restore; everything
 * else requires granted access.
 */
export function guardTransportCommand(kind: string, access: string): TransportGuard {
  if (ALWAYS_ALLOWED.has(kind)) return { allowed: true, restoreFirst: false };
  if (kind === 'play') {
    if (isAccessGranted(access)) return { allowed: true, restoreFirst: false };
    return { allowed: true, restoreFirst: true, reason: access || 'Select a queue occurrence' };
  }
  if (isAccessGranted(access)) return { allowed: true, restoreFirst: false };
  return { allowed: false, restoreFirst: false, reason: access || 'Select a queue occurrence' };
}
