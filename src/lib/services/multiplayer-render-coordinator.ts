/**
 * Host-side render coordinator: owns the worker pool, deduplicates concurrent
 * renders for the same cache key, and pins active renders in the shared LRU
 * cache. One shared set of cluster ArrayBuffers serves every peer; per-peer
 * queues only hold cluster indexes.
 */

import type { PlaylistItem } from '$lib/types';
import { logInfo, logWarning } from '$lib/services/logging';
import {
  MultiplayerRenderCache,
  buildRenderCacheKey,
  type CachedRender
} from './multiplayer-render-cache';
import type { MultiplayerRenderManifest } from './multiplayer-protocol';
import type {
  MultiplayerRenderRequest,
  MultiplayerRenderResult
} from './multiplayer-render.worker';

export const DEFAULT_RENDER_CACHE_LIMIT_MIB = 256;

interface PendingJob {
  key: string;
  track: PlaylistItem;
  bitrateKbps: number;
  token: number;
  resolve: (render: CachedRender) => void;
  reject: (error: Error) => void;
}

type WorkerResponse =
  | { type: 'progress'; stage: 'decode' | 'render' | 'encode'; progress: number | null }
  | MultiplayerRenderResult
  | { type: 'error'; message: string };

class MultiplayerRenderCoordinator {
  #cache = new MultiplayerRenderCache(DEFAULT_RENDER_CACHE_LIMIT_MIB * 1024 * 1024);
  #inflight = new Map<string, Promise<CachedRender>>();
  #worker: Worker | null = null;
  #queue: PendingJob[] = [];
  #active: PendingJob | null = null;
  #renderToken = 0;
  #lastRenderDiagnostics = new Map<string, { hits: number; startedAt: number }>();

  get cacheSizeBytes(): number {
    return this.#cache.sizeBytes;
  }

  get cacheEntryCount(): number {
    return this.#cache.entryCount;
  }

  setCacheLimitMiB(limitMiB: number): void {
    this.#cache.setCapacityBytes(Math.max(0, limitMiB) * 1024 * 1024);
  }

  clear(): void {
    this.#renderToken += 1;
    this.#queue = [];
    this.#active = null;
    if (this.#worker) {
      this.#worker.terminate();
      this.#worker = null;
    }
    this.#inflight.clear();
    this.#cache.clear();
  }

  /** Renders a track (or returns the cached render), sharing one result across peers. */
  getRender(track: PlaylistItem, bitrateKbps: number): Promise<CachedRender> {
    if (!track.file) return Promise.reject(new Error('No source file available for rendering.'));
    const key = buildRenderCacheKey(track, bitrateKbps);
    const cached = this.#cache.get(key);
    if (cached) {
      const startedAt = this.#lastRenderDiagnostics.get(key)?.startedAt;
      logInfo('multiplayer', 'Render cache hit', {
        renderId: cached.renderId,
        trackId: track.id,
        startedAt: startedAt ?? null,
        sizeBytes: cached.sizeBytes
      });
      return Promise.resolve(cached);
    }
    const inflight = this.#inflight.get(key);
    if (inflight) return inflight;

    const promise = new Promise<CachedRender>((resolve, reject) => {
      this.#queue.push({ key, track, bitrateKbps, token: this.#renderToken, resolve, reject });
      this.#pump();
    });
    this.#inflight.set(key, promise);
    void promise.catch(() => {
      // The cache keeps successful renders; failed keys may be retried.
    }).finally(() => {
      this.#inflight.delete(key);
    });
    return promise;
  }

  pin(key: string): void {
    this.#cache.pin(key);
  }

  unpin(key: string): void {
    this.#cache.unpin(key);
  }

  /** Drops queued/in-flight work that no longer has consumers. */
  cancelUnused(): void {
    this.#renderToken += 1;
    const abandoned = this.#queue;
    this.#queue = [];
    for (const job of abandoned) {
      job.reject(new Error('Render canceled because it no longer has consumers.'));
    }
    // In-flight work finishes and lands in the LRU; it is not interrupted.
  }

  #pump(): void {
    if (this.#active || this.#queue.length === 0) return;
    const job = this.#queue.shift();
    if (!job) return;
    if (job.token !== this.#renderToken) {
      job.reject(new Error('Render canceled because it no longer has consumers.'));
      this.#pump();
      return;
    }
    this.#active = job;
    const startedAt = Date.now();
    this.#lastRenderDiagnostics.set(job.key, { hits: 0, startedAt });
    logInfo('multiplayer', 'Render started', {
      trackId: job.track.id,
      name: job.track.name,
      kind: job.track.kind,
      bitrateKbps: job.bitrateKbps
    });
    void this.#run(job).finally(() => {
      this.#active = null;
      this.#pump();
    });
  }

  async #run(job: PendingJob): Promise<void> {
    const worker = this.#ensureWorker();
    const request: MultiplayerRenderRequest = {
      type: 'render',
      name: job.track.name,
      extension: job.track.extension,
      kind: job.track.kind === 'module' ? 'module' : 'stream',
      file: job.track.kind === 'module' ? null : job.track.file ?? null,
      moduleBytes: job.track.kind === 'module' ? await job.track.file!.arrayBuffer() : null,
      bitrateKbps: job.bitrateKbps,
      hivelyWasmUrl: new URL('/vendor/hively-replay.wasm', document.baseURI).href,
      libopenmptUrl: new URL(
        import.meta.env.DEV
          ? '/src/lib/vendor/chiptune3/libopenmpt.worklet.js'
          : '/assets/libopenmpt.worklet.js',
        document.baseURI
      ).href
    };

    const result = await new Promise<MultiplayerRenderResult>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerResponse>): void => {
        const response = event.data;
        if (response.type === 'progress') return;
        if (response.type === 'error') {
          reject(new Error(response.message));
          return;
        }
        resolve(response);
      };
      worker.onmessage = onMessage;
      worker.onerror = () => reject(new Error('The render worker failed to start.'));
      const transfer: Transferable[] = [];
      if (request.moduleBytes) transfer.push(request.moduleBytes);
      worker.postMessage(request, transfer);
    });

    const durationMs = Math.max(1, Math.round(result.durationMs));
    const clusters = result.clusters.map((bytes, index) => ({
      index,
      timeMs: Math.max(0, Math.round(result.clusterTimeMs[index] ?? 0)),
      sizeBytes: bytes.byteLength
    }));
    const totalBytes = result.init.byteLength
      + clusters.reduce((total, cluster) => total + cluster.sizeBytes, 0);
    const renderId = crypto.randomUUID();
    const manifest: MultiplayerRenderManifest = {
      generationId: 'unassigned',
      renderId,
      trackId: job.track.id,
      codec: 'opus',
      container: 'webm',
      durationMs,
      bitrateKbps: job.bitrateKbps,
      clusterDurationMs: result.clusterDurationMs,
      clusters,
      initSizeBytes: result.init.byteLength,
      totalBytes
    };
    const render: CachedRender = {
      renderId,
      manifest,
      init: result.init,
      clusters: result.clusters,
      sizeBytes: totalBytes
    };
    this.#cache.put(job.key, render);
    const elapsedMs = Date.now() - (this.#lastRenderDiagnostics.get(job.key)?.startedAt ?? Date.now());
    logInfo('multiplayer', 'Render completed', {
      renderId,
      trackId: job.track.id,
      clusters: clusters.length,
      bytes: totalBytes,
      durationMs,
      elapsedMs
    });
    job.resolve(render);
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    const worker = new Worker(new URL('./multiplayer-render.worker.ts', import.meta.url), {
      type: 'module'
    });
    worker.onerror = () => {
      logWarning('multiplayer', 'Render worker crashed; future renders will retry');
    };
    this.#worker = worker;
    return worker;
  }
}

export const multiplayerRenderCoordinator = new MultiplayerRenderCoordinator();
