/**
 * Client-side cache for buffered Opus renders: retains the compressed init
 * and clusters of recently-seen (track, bitrate) renders so loop playback
 * doesn't re-download the same bytes over the render channel. The bound is
 * deliberately smaller than the host's render cache.
 */

import type { MultiplayerRenderManifest } from './multiplayer-protocol';

const CLIENT_RENDER_CACHE_LIMIT_MIB = 64;

export interface ClientCachedRender {
  manifest: MultiplayerRenderManifest;
  init: Uint8Array;
  clusters: Map<number, Uint8Array>;
}

interface CacheEntry extends ClientCachedRender {
  trackId: string;
  sourceRevision: string;
  lastUsedAt: number;
}

export function buildClientRenderCacheKey(
  trackId: string,
  sourceRevision: string,
  bitrateKbps: number
): string {
  return `${trackId}:${sourceRevision}:${bitrateKbps}`;
}

/**
 * True when a cached render has the same explicit source revision and encoded
 * structure as a fresh manifest.
 */
export function renderMatchesManifest(
  cached: ClientCachedRender,
  manifest: MultiplayerRenderManifest
): boolean {
  const previous = cached.manifest;
  if (previous.sourceRevision !== manifest.sourceRevision) return false;
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

/**
 * True when two renders lay out their audio identically (same duration,
 * cluster grid, and cluster time boundaries) even if the encoded sizes differ.
 * That is what makes a higher-bitrate cached render a valid substitute for a
 * fresh lower-bitrate manifest: the bytes are self-describing and the seek
 * math (cluster index per time) is unchanged.
 */
export function renderLayoutMatches(
  left: MultiplayerRenderManifest,
  right: MultiplayerRenderManifest
): boolean {
  if (left.durationMs !== right.durationMs) return false;
  if (left.clusterDurationMs !== right.clusterDurationMs) return false;
  if (left.clusters.length !== right.clusters.length) return false;
  for (let index = 0; index < left.clusters.length; index += 1) {
    if (left.clusters[index].timeMs !== right.clusters[index].timeMs) return false;
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
    this.#entries.set(key, {
      ...render,
      trackId: render.manifest.trackId,
      sourceRevision: render.manifest.sourceRevision,
      lastUsedAt: now()
    });
    this.#evict();
  }

  /**
   * Returns a complete cached render of the same track and source revision
   * encoded at a strictly higher bitrate than the host's current choice. The
   * cached bytes are exactly what the host previously rendered, so they are
   * valid to play without a re-download; the closest higher bitrate wins so
   * the pipeline matches the host's quality intent as closely as possible.
   * Incomplete renders are skipped because a partial substitute could never
   * finish downloading (the host is rendering a different bitrate now).
   */
  findHigherBitrate(
    trackId: string,
    sourceRevision: string,
    bitrateKbps: number
  ): ClientCachedRender | null {
    let best: CacheEntry | null = null;
    for (const entry of this.#entries.values()) {
      if (entry.trackId !== trackId || entry.sourceRevision !== sourceRevision) continue;
      const cachedBitrate = entry.manifest.bitrateKbps;
      if (cachedBitrate <= bitrateKbps) continue;
      if (entry.clusters.size !== entry.manifest.clusters.length) continue;
      if (!best || cachedBitrate < best.manifest.bitrateKbps) best = entry;
    }
    if (!best) return null;
    best.lastUsedAt = now();
    return best;
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
