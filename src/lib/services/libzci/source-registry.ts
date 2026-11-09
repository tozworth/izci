import type { TrackItem } from '$lib/types';
import { sourceReferenceForTrack, validateSourceReference } from './queue-commands';
import type { CoreSourceReference } from './queue-snapshot';

/**
 * Transitional live-`File` registry for core source keys.
 *
 * Core queue/catalog rows persist only `{key,kind,locator,display_path}`.
 * Handles, blobs and URLs never enter domain storage. This registry keeps
 * the live `File` objects for `ephemeral` sources (plain File inputs) and
 * staged `browser_handle`/`native_path` sources until the future owner
 * worker resolves them through `Capabilities`/native materialization.
 *
 * Mirrors the crude `ProfileController.files` map plus the
 * `references_source` GC rule: keys no longer referenced by core are dropped.
 * No IndexedDB, OPFS, or SQL lives here.
 */

export interface QueueLoadLike {
  occurrence: number;
  source: CoreSourceReference;
  position_seconds: number;
  subsong: number | null;
  autoplay: boolean;
}

/** Validate a `QueueLoad` descriptor before materializing it. */
export function validateQueueLoad(load: QueueLoadLike): void {
  if (!Number.isSafeInteger(load.occurrence) || load.occurrence <= 0) {
    throw new Error(`Invalid queue load occurrence: ${String(load.occurrence)}`);
  }
  validateSourceReference(load.source);
  if (typeof load.position_seconds !== 'number' || !Number.isFinite(load.position_seconds) || load.position_seconds < 0) {
    throw new Error(`Invalid queue load position: ${String(load.position_seconds)}`);
  }
  if (load.subsong !== null && (!Number.isSafeInteger(load.subsong) || load.subsong < 0)) {
    throw new Error(`Invalid queue load subsong: ${String(load.subsong)}`);
  }
  if (typeof load.autoplay !== 'boolean') {
    throw new Error('Invalid queue load autoplay: expected boolean');
  }
}

export class CoreSourceRegistry {
  readonly #files = new Map<string, File>();

  get size(): number {
    return this.#files.size;
  }

  /** Store the live `File` for a core source key. Overwrites are explicit. */
  register(key: string, file: File): void {
    if (!key || key.length > 8192 || key.includes('\0')) {
      throw new Error(`Invalid source key: ${key}`);
    }
    this.#files.set(key, file);
  }

  /**
   * Register a Svelte track and return its core `SourceReference`.
   * The live `File` is retained only when the track carries one; handle-only
   * or native-only tracks resolve later through capabilities/materialization.
   */
  registerTrack(track: TrackItem, key?: string): CoreSourceReference {
    const reference = sourceReferenceForTrack(track, key);
    if (track.file) this.#files.set(reference.key, track.file);
    return reference;
  }

  has(key: string): boolean {
    return this.#files.has(key);
  }

  /**
   * Resolve a `QueueLoad` to its live `File`.
   * Returns `null` when the source needs capability/native resolution
   * through the future owner worker (`access-required`), never throws for
   * a well-formed load.
   */
  resolveLoad(load: QueueLoadLike): File | null {
    return this.#files.get(load.source.key) ?? null;
  }

  /** Drop keys no longer referenced by core (mirrors `references_source` GC). */
  retain(referenced: Set<string> | readonly string[]): void {
    const live = referenced instanceof Set ? referenced : new Set(referenced);
    for (const key of [...this.#files.keys()]) {
      if (!live.has(key)) this.#files.delete(key);
    }
  }

  remove(key: string): boolean {
    return this.#files.delete(key);
  }

  clear(): void {
    this.#files.clear();
  }

  keys(): string[] {
    return [...this.#files.keys()];
  }
}
