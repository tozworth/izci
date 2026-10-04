/**
 * Host-side render coordinator: owns the worker pool, deduplicates concurrent
 * renders for the same cache key, and pins active renders in the shared LRU
 * cache. One shared set of cluster ArrayBuffers serves every peer; per-peer
 * queues only hold cluster indexes.
 */

import type { TrackItem } from '$lib/types';
import { logInfo, logWarning } from '$lib/services/logging';
import { errorMessage } from './multiplayer-utils';
import {
  MultiplayerRenderCache,
  buildRenderCacheKey,
  buildRenderSourceRevision,
  type CachedRender
} from './multiplayer-render-cache';
import type { MultiplayerRenderManifest } from './multiplayer-protocol';
import type {
  MultiplayerRenderRequest,
  MultiplayerRenderResult
} from './multiplayer-render.worker';

const DEFAULT_RENDER_CACHE_LIMIT_MIB = 256;

interface PendingJob {
  key: string;
  track: TrackItem;
  bitrateKbps: number;
  token: number;
  resolve: (render: CachedRender) => void;
  reject: (error: Error) => void;
  cancel?: () => void;
  startedAt?: number;
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
    const cancellation = new Error('Render coordinator was cleared.');
    this.#active?.reject(cancellation);
    this.#active?.cancel?.();
    for (const job of this.#queue) job.reject(cancellation);
    this.#queue = [];
    this.#active = null;
    if (this.#worker) {
      this.#worker.terminate();
      this.#worker = null;
    }
    this.#inflight.clear();
    this.#cache.clear();
  }

  /** Acquires a pinned render, sharing one encode across concurrent peers. */
  acquireRender(track: TrackItem, bitrateKbps: number): Promise<CachedRender> {
    if (!track.file) return Promise.reject(new Error('No source file available for rendering.'));
    const key = buildRenderCacheKey(track, bitrateKbps);
    const cached = this.#cache.get(key);
    if (cached) {
      logInfo('multiplayer', 'Render cache hit', {
        renderId: cached.renderId,
        trackId: track.id,
        sizeBytes: cached.sizeBytes
      });
      this.#cache.pin(key);
      return Promise.resolve(cached);
    }
    let inflight = this.#inflight.get(key);
    if (!inflight) {
      const created = new Promise<CachedRender>((resolve, reject) => {
        this.#queue.push({ key, track, bitrateKbps, token: this.#renderToken, resolve, reject });
        this.#pump();
      });
      inflight = created;
      this.#inflight.set(key, created);
      void created.catch(() => {
        // The cache keeps successful renders; failed keys may be retried.
      }).finally(() => {
        if (this.#inflight.get(key) === created) this.#inflight.delete(key);
      });
    }
    return inflight.then((render) => {
      this.#cache.pin(key);
      return render;
    });
  }

  unpin(key: string): void {
    this.#cache.unpin(key);
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
    job.startedAt = Date.now();
    logInfo('multiplayer', 'Render started', {
      trackId: job.track.id,
      name: job.track.name,
      kind: job.track.kind,
      bitrateKbps: job.bitrateKbps
    });
    void this.#run(job).catch((error) => {
      job.reject(error instanceof Error ? error : new Error(String(error)));
    }).finally(() => {
      job.cancel = undefined;
      if (this.#active === job) {
        this.#active = null;
        this.#pump();
      }
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
      subsong: job.track.subsong
    };

    let result: MultiplayerRenderResult;
    try {
      result = await new Promise<MultiplayerRenderResult>((resolve, reject) => {
        job.cancel = () => reject(new Error('Render coordinator was cleared.'));
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
        worker.onerror = () => reject(new Error('The render worker failed.'));
        const transfer: Transferable[] = [];
        if (request.moduleBytes) transfer.push(request.moduleBytes);
        worker.postMessage(request, transfer);
      });
    } catch (error) {
      logWarning('multiplayer', 'Render failed', {
        trackId: job.track.id,
        name: job.track.name,
        error: errorMessage(error, 'render failed')
      });
      throw error;
    }

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
      sourceRevision: buildRenderSourceRevision(job.track),
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
    // Hold one coordinator pin until promise reactions acquire their peer pins.
    // This prevents an oversized render from being evicted between put() and
    // the first caller attaching it to a peer.
    this.#cache.put(job.key, render, 1);
    const elapsedMs = Date.now() - (job.startedAt ?? Date.now());
    logInfo('multiplayer', 'Render completed', {
      renderId,
      trackId: job.track.id,
      clusters: clusters.length,
      bytes: totalBytes,
      durationMs,
      elapsedMs
    });
    job.resolve(render);
    queueMicrotask(() => this.#cache.unpin(job.key));
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    const worker = new Worker(new URL('./multiplayer-render.worker.ts', import.meta.url), {
      type: 'module'
    });
    worker.addEventListener('error', () => {
      if (this.#worker === worker) {
        this.#worker = null;
        worker.terminate();
      }
      logWarning('multiplayer', 'Render worker crashed; future renders will retry');
    });
    this.#worker = worker;
    return worker;
  }
}

export const multiplayerRenderCoordinator = new MultiplayerRenderCoordinator();
