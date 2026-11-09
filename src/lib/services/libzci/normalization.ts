/**
 * Svelte-side boundary for core normalization observation.
 *
 * The shared session applies ReplayGain/R128 policy in native callbacks and
 * the import-free worklet (`normalization`, `gain_schedule`); the Svelte
 * shell keeps a temporary bus-local gain bridge until the queue/library
 * slice moves ownership fully into core. This module pins the `Normalization`
 * shape published on engine snapshots (as consumed by the crude
 * `normalizationView`) so the future owner worker can surface effective gain
 * without owning policy.
 *
 * Shapes mirror the Rust `replay_gain::Normalization`/`GainOrigin`.
 */

export type CoreGainOrigin = 'off' | 'missing' | 'track' | 'album' | 'r128_track' | 'r128_album';

export interface CoreNormalization {
  origin: CoreGainOrigin;
  gain_db: number;
  linear: number;
  clipping_limited: boolean;
}

const ORIGINS: ReadonlySet<string> = new Set([
  'off',
  'missing',
  'track',
  'album',
  'r128_track',
  'r128_album'
]);

/** Validate an engine normalization snapshot before feeding Svelte stores. */
export function validateCoreNormalization(normalization: CoreNormalization): void {
  if (!ORIGINS.has(normalization.origin)) {
    throw new Error(`Invalid normalization origin: ${String(normalization.origin)}`);
  }
  if (typeof normalization.gain_db !== 'number' || !Number.isFinite(normalization.gain_db)) {
    throw new Error(`Invalid normalization gain_db: ${String(normalization.gain_db)}`);
  }
  if (typeof normalization.linear !== 'number' || !Number.isFinite(normalization.linear) || normalization.linear < 0) {
    throw new Error(`Invalid normalization linear: ${String(normalization.linear)}`);
  }
  if (typeof normalization.clipping_limited !== 'boolean') {
    throw new Error('Invalid normalization clipping_limited: expected boolean');
  }
}

/** True when core applies an audible gain (any origin except `off`). */
export function isNormalizationActive(normalization: CoreNormalization): boolean {
  return normalization.origin !== 'off';
}

/** Effective linear gain for display; falls back to unity on bad input. */
export function effectiveLinearGain(normalization: CoreNormalization): number {
  if (typeof normalization.linear !== 'number' || !Number.isFinite(normalization.linear) || normalization.linear < 0) {
    return 1;
  }
  return normalization.linear;
}
