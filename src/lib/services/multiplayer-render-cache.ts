/**
 * Bounded in-memory cache for compressed render outputs, shared across peers.
 * Entries are pinned while a peer's generation is current; unpinned entries are
 * evicted by compressed-byte LRU under a configurable cap.
 */

import type { MultiplayerRenderManifest } from './multiplayer-protocol';

export interface CachedRender {
  renderId: string;
  manifest: MultiplayerRenderManifest;
  init: ArrayBuffer;
  clusters: ArrayBuffer[];
  /** Compressed byte size including init. */
  sizeBytes: number;
}

interface CacheEntry extends CachedRender {
  pinned: number;
  lastUsedAt: number;
  bytes: number;
}

const RENDER_VERSION = 2;

interface RenderSourceIdentity {
  path?: string;
  name: string;
  size: number;
  lastModified: number;
  subsong?: number;
}

export function buildRenderSourceRevision(track: RenderSourceIdentity): string {
  return [
    RENDER_VERSION,
    track.size,
    track.lastModified,
    track.subsong ?? 0
  ].join(':');
}

export function buildRenderCacheKey(
  track: RenderSourceIdentity,
  bitrateKbps: number
): string {
  return [
    track.path ?? track.name,
    buildRenderSourceRevision(track),
    bitrateKbps,
    48_000,
    2
  ].join(':');
}

export class MultiplayerRenderCache {
  #entries = new Map<string, CacheEntry>();
  #capacityBytes: number;

  constructor(capacityBytes: number) {
    this.#capacityBytes = Math.max(0, capacityBytes);
  }

  setCapacityBytes(capacityBytes: number): void {
    this.#capacityBytes = Math.max(0, capacityBytes);
    this.#evict();
  }

  get(key: string): CachedRender | null {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    entry.lastUsedAt = now();
    return entry;
  }

  put(key: string, render: CachedRender, initialPins = 0): void {
    const existing = this.#entries.get(key);
    if (existing) {
      existing.lastUsedAt = now();
      return;
    }
    const entry: CacheEntry = {
      ...render,
      pinned: Math.max(0, Math.floor(initialPins)),
      lastUsedAt: now(),
      bytes: render.sizeBytes
    };
    this.#entries.set(key, entry);
    this.#evict();
  }

  pin(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    entry.pinned += 1;
    entry.lastUsedAt = now();
  }

  unpin(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    entry.pinned = Math.max(0, entry.pinned - 1);
    this.#evict();
  }

  remove(key: string): void {
    this.#entries.delete(key);
  }

  get sizeBytes(): number {
    let total = 0;
    for (const entry of this.#entries.values()) total += entry.bytes;
    return total;
  }

  get entryCount(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  #evict(): void {
    let total = 0;
    const unpinned: Array<{ key: string; lastUsedAt: number; bytes: number }> = [];
    for (const [key, entry] of this.#entries) {
      total += entry.bytes;
      if (entry.pinned === 0) unpinned.push({ key, lastUsedAt: entry.lastUsedAt, bytes: entry.bytes });
    }
    if (total <= this.#capacityBytes) return;
    unpinned.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const candidate of unpinned) {
      if (total <= this.#capacityBytes) break;
      this.#entries.delete(candidate.key);
      total -= candidate.bytes;
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
