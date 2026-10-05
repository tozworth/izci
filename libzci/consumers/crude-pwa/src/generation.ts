/**
 * Generation helpers: pure functions over session/generation identity.
 * Tested under `test/` with vitest (node, no browser).
 */

/** A tagged worker result with its session/generation identity. */
export interface Tagged {
  session: number;
  generation: number;
}

/**
 * Whether `result` is still authoritative for `current`. Late results
 * from an older generation must be released, never rendered.
 */
export function isCurrent(result: Tagged, current: Tagged): boolean {
  return result.session === current.session && result.generation === current.generation;
}

/**
 * Coalesce rapid progress updates: keep the latest per session,
 * bounded by `limit`. Completions/errors are never coalesced away —
 * callers pass only telemetry here.
 */
export function coalesceProgress<T extends Tagged>(events: T[], limit: number): T[] {
  const latest = new Map<number, T>();
  for (const event of events) latest.set(event.session, event);
  return [...latest.values()].slice(-Math.max(1, limit));
}

/**
 * Parse a `{kind, detail}` worker error into a stable kind label plus
 * detail. Unknown shapes become `unknown` (never thrown through).
 */
export function parseWorkerError(value: unknown): { kind: string; detail: string } {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record['kind'] === 'string') {
      return { kind: record['kind'], detail: typeof record['detail'] === 'string' ? record['detail'] : '' };
    }
    if (value instanceof Error) return { kind: 'internal', detail: value.message };
  }
  if (value instanceof Error) return { kind: 'internal', detail: value.message };
  return { kind: 'unknown', detail: String(value) };
}
