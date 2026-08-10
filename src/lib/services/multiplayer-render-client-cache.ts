/**
 * Client-side cache for buffered Opus renders: retains the compressed init
 * and clusters of recently-seen (track, bitrate) renders so loop playback
 * doesn't re-download the same bytes over the render channel. The bound is
 * deliberately smaller than the host's render cache.
 */

import type { MultiplayerRenderManifest } from './multiplayer-protocol';

export const CLIENT_RENDER_CACHE_LIMIT_MIB = 64;

export interface ClientCachedRender {
  manifest: MultiplayerRenderManifest;
  init: Uint8Array;
  clusters: Map<number, Uint8Array>;
}

interface CacheEntry extends ClientCachedRender {
  lastUsedAt: number;
}

export function buildClientRenderCacheKey(trackId: string, bitrateKbps: number): string {
  return `${trackId}:${bitrateKbps}`;
}

/**
 * True when a cached render is structurally identical to a fresh manifest.
 * Renders are deterministic for a given source, bitrate, and renderer version,
 * so matching duration, bitrate, cluster count, per-cluster time/size, and
 * init size means the retained bytes are safe to reuse for the new renderId.
 */
export function renderMatchesManifest(
  cached: ClientCachedRender,
  manifest: MultiplayerRenderManifest
): boolean {
  const previous = cached.manifest;
  if (previous.durationMs !== manifest.durationMs) return false;
  if (previous.bitrateKbps !== manifest.bitrateKbps) return false;
  if (previous.clusterDurationMs !== manifest.clusterDurationMs) return false;
  if (previous.initSizeBytes !== manifest.initSizeBytes) return false;
  const clusters = manifest.clusters;
  if (previous.clusters.length !== clusters.length) return false;
  for (let index = 0; index < clusters.length; index += 1) {
    if (previous.clusters[index].timeMs !== clusters[index].timeMs) return false;
    if (previous.clusters[index].sizeBytes !== clusters[index].sizeBytes) return false;
  }
  return true;
}

function isClusterSuperset(outer: Map<number, Uint8Array>, inner: Map<number, Uint8Array>): boolean {
  for (const index of inner.keys()) {
    if (!outer.has(index)) return false;
  }
  return true;
}

export class MultiplayerRenderClientCache {
  #entries = new Map<string, CacheEntry>();
  #capacityBytes: number;

  constructor(capacityBytes: number = CLIENT_RENDER_CACHE_LIMIT_MIB * 1024 * 1024) {
    this.#capacityBytes = Math.max(0, capacityBytes);
  }

  get(key: string): ClientCachedRender | null {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    entry.lastUsedAt = now();
    return entry;
  }

  put(key: string, render: ClientCachedRender): void {
    const existing = this.#entries.get(key);
    if (existing
      && renderMatchesManifest(existing, render.manifest)
      && isClusterSuperset(existing.clusters, render.clusters)) {
      // Keep the richer entry; the fresh render adds nothing.
      existing.lastUsedAt = now();
      return;
    }
    this.#entries.set(key, { ...render, lastUsedAt: now() });
    this.#evict();
  }

  clear(): void {
    this.#entries.clear();
  }

  get sizeBytes(): number {
    let total = 0;
    for (const entry of this.#entries.values()) {
      total += entry.init.byteLength;
      for (const bytes of entry.clusters.values()) total += bytes.byteLength;
    }
    return total;
  }

  get entryCount(): number {
    return this.#entries.size;
  }

  #evict(): void {
    let total = this.sizeBytes;
    if (total <= this.#capacityBytes) return;
    const candidates = Array.from(this.#entries.entries())
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    for (const [key, entry] of candidates) {
      if (total <= this.#capacityBytes) break;
      let entryBytes = entry.init.byteLength;
      for (const bytes of entry.clusters.values()) entryBytes += bytes.byteLength;
      this.#entries.delete(key);
      total -= entryBytes;
    }
  }
}

export const clientRenderCache = new MultiplayerRenderClientCache();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
