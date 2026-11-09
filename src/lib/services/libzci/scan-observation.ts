/**
 * Svelte-side boundary for managed scan progress observation.
 *
 * The owner worker publishes one scan observation per snapshot (see the crude
 * `BrowserCatalog.observation` consumed alongside `profile` snapshots):
 * idle/scanning/failed with the active root, visited/accepted/ignored
 * counters, and a human-readable detail. Staging, enumeration, and
 * reconciliation belong to the future scan slice; nothing here starts scans
 * or touches directories.
 *
 * Shapes mirror `libzci/consumers/crude-pwa/src/catalog-types.ts`
 * `ScanObservation`.
 */

export type ScanObservationState = 'idle' | 'scanning' | 'failed';

export interface CoreScanObservation {
  state: ScanObservationState;
  root: number | null;
  visited: number;
  accepted: number;
  ignored: number;
  detail: string;
}

const STATES: ReadonlySet<string> = new Set(['idle', 'scanning', 'failed']);

function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
}

/** Idle observation for components before the first snapshot. */
export function idleScanObservation(): CoreScanObservation {
  return { state: 'idle', root: null, visited: 0, accepted: 0, ignored: 0, detail: '' };
}

/** Validate a scan observation before feeding it to Svelte stores. */
export function validateScanObservation(observation: CoreScanObservation): void {
  if (!STATES.has(observation.state)) {
    throw new Error(`Invalid scan state: ${String(observation.state)}`);
  }
  if (observation.root !== null && (!Number.isSafeInteger(observation.root) || observation.root <= 0)) {
    throw new Error(`Invalid scan root: ${String(observation.root)}`);
  }
  for (const [field, value] of [['visited', observation.visited], ['accepted', observation.accepted], ['ignored', observation.ignored]] as const) {
    if (!isValidCount(value)) throw new Error(`Invalid scan ${field}: ${String(value)}`);
  }
  if (typeof observation.detail !== 'string' || observation.detail.length > 4096 || observation.detail.includes('\0')) {
    throw new Error('Invalid scan detail: expected 0..4096 chars without NUL');
  }
}

/** True while a root enumeration/probe run is active. */
export function isScanActive(observation: CoreScanObservation): boolean {
  return observation.state === 'scanning';
}

/** True when the last run failed; `detail` carries the reason. */
export function isScanFailed(observation: CoreScanObservation): boolean {
  return observation.state === 'failed';
}
