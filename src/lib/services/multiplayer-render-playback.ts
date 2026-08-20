/**
 * Client-side buffered Opus playback: one Multiplayer-owned MediaSource/SourceBuffer
 * pipeline whose hidden audio element enters the shared listener audio graph
 * (transition envelope -> ReplayGain -> Raf -> analyser -> master volume).
 *
 * Appends are kept in ascending timestamp order within each requested window;
 * sparse buffered ranges are allowed. Readiness, rebuffering at the buffered
 * edge, seek epochs, and generation cleanup all live here.
 */

import { audioBusService } from '$lib/services/audio-bus';
import { logDebug, logInfo } from '$lib/services/logging';
import {
  buildClientRenderCacheKey,
  clientRenderCache,
  renderLayoutMatches,
  renderMatchesManifest
} from './multiplayer-render-client-cache';
import { compactClusterRanges } from './multiplayer-render-scheduler';
import { multiplayerRenderDiskCache } from './multiplayer-render-disk-cache';
import {
  BUFFER_MONITOR_INTERVAL_MS,
  DRIFT_CORRECTION_THRESHOLD_MS,
  REBUFFER_EDGE_MARGIN_MS,
  STALL_CHECK_INTERVAL_MS,
  expectedPositionMs,
  hasRequiredRenderWindow,
  hasTimelineDiscontinuity,
  renderGapRecoveryTargetMs,
  renderStallRecoveryNeeded
} from './multiplayer-render-playback-math';
import { RENDER_INIT_CLUSTER_INDEX } from './multiplayer-render-transfer';
import type {
  MultiplayerPlayback,
  MultiplayerRenderManifest
} from './multiplayer-protocol';

export interface RenderPlaybackCallbacks {
  /** The contiguous startup window exists at the intended start position. */
  onReady: (epoch: number, positionMs: number) => void;
  /** The client needs a new window (rebuffer or seek). */
  onNeed: (need: {
    epoch: number;
    targetTimeMs: number;
    aheadMs: number;
    ranges: Array<[number, number]>;
  }) => void;
}

export interface RenderPlaybackState {
  generationId: string | null;
  trackId: string | null;
  renderId: string;
  ready: boolean;
  buffering: boolean;
  bufferedMs: number;
  /** Buffered media ranges in ms ([start, end]); sparse ranges allowed. */
  bufferedRanges: Array<[number, number]>;
  receivedClusters: number;
  receivedBytes: number;
  epoch: number;
}

export class MultiplayerRenderPlaybackService {
  #callbacks: RenderPlaybackCallbacks | null = null;
  #generationId: string | null = null;
  #trackId: string | null = null;
  #manifest: MultiplayerRenderManifest | null = null;
  #epoch = 0;
  #enabled = true;
  #audible = false;

  #mediaSource: MediaSource | null = null;
  #sourceBuffer: SourceBuffer | null = null;
  #element: HTMLAudioElement | null = null;
  #sourceNode: AudioNode | null = null;
  #objectUrl: string | null = null;

  #initBytes: Uint8Array | null = null;
  #initAppended = false;
  /** Init fragments that arrived before the manifest (unordered-channel race). */
  #pendingInitRenderId: string | null = null;
  #pendingInitFragments = new Map<number, Uint8Array>();
  #received = new Map<number, Uint8Array>();
  #fragments = new Map<number, Map<number, Uint8Array>>();
  #nextAppendIndex = 0;
  #chain: Promise<void> = Promise.resolve();
  #chainToken = 0;

  #ready = false;
  #rebuffering = false;
  #playback: MultiplayerPlayback | null = null;
  #monitorTimer: number | null = null;
  #stallTimer: number | null = null;
  #lastProgressAt = 0;
  #receivedBytes = 0;

  setCallbacks(callbacks: RenderPlaybackCallbacks): void {
    this.#callbacks = callbacks;
  }

  getState(): RenderPlaybackState {
    return {
      generationId: this.#generationId,
      trackId: this.#trackId,
      renderId: this.#manifest?.renderId ?? '',
      ready: this.#ready,
      // A started generation that is not ready is loading for the whole
      // interval: the host renders/transfers the Opus while the client
      // waits, so the pre-manifest gap must read as loading too, not just
      // the post-manifest download and rebuffers.
      buffering: this.#rebuffering || (!this.#ready && this.#generationId !== null),
      bufferedMs: this.#bufferedMs(),
      bufferedRanges: this.#bufferedRanges(),
      receivedClusters: this.#received.size,
      receivedBytes: this.#receivedBytes,
      epoch: this.#epoch
    };
  }

  isReady(): boolean {
    return this.#ready;
  }

  isCurrent(generationId: string): boolean {
    return this.#generationId === generationId;
  }

  /** New delivery generation: tear down anything from the previous one. */
  start(generationId: string, trackId: string): void {
    const changed = this.#generationId !== generationId;
    if (changed) {
      // Retain the outgoing render's compressed bytes before the teardown:
      // loop playback reuses them instead of re-downloading the same render.
      this.#cacheCurrentRender();
    }
    this.#generationId = generationId;
    this.#trackId = trackId;
    this.#epoch = 0;
    this.#manifest = null;
    this.#ready = false;
    this.#rebuffering = false;
    this.#playback = null;
    this.#receivedBytes = 0;
    if (changed) {
      this.#releaseMedia();
      this.#stopStallDetector();
      // Received payloads are generation-scoped: stale clusters from the
      // previous render must never be appended into the new MediaSource.
      this.#received.clear();
      this.#fragments.clear();
      this.#initBytes = null;
      this.#pendingInitRenderId = null;
      this.#pendingInitFragments.clear();
    }
  }

  setManifest(manifest: MultiplayerRenderManifest): boolean {
    if (manifest.generationId !== this.#generationId) return false;
    this.#manifest = manifest;
    this.#releaseMedia();
    // A matching track/source revision/bitrate can skip the re-download; a
    // complete cached render at a higher bitrate can too (see #cachedRenderFor).
    const cached = this.#cachedRenderFor(manifest);
    if (cached) {
      this.#manifest = cached.manifest;
      this.#initBytes = cached.init;
      this.#received = cached.clusters;
      this.#receivedBytes = cached.bytes;
      this.#nextAppendIndex = 0;
      this.#pendingInitRenderId = null;
      this.#pendingInitFragments.clear();
      logInfo('multiplayer', cached.manifest.bitrateKbps === manifest.bitrateKbps
        ? 'Buffered Opus client cache hit'
        : 'Buffered Opus client cache hit (higher bitrate)', {
        trackId: manifest.trackId,
        renderId: manifest.renderId,
        cachedRenderId: cached.renderId,
        cachedBitrate: cached.manifest.bitrateKbps,
        hostBitrate: manifest.bitrateKbps,
        clusters: cached.clusters.size,
        bytes: cached.bytes
      });
      this.#finishManifestSetup(manifest, true);
    } else {
      // The in-memory cache missed: consult the cross-session IndexedDB cache
      // BEFORE any network bytes are requested, so a complete hit (exact or
      // higher bitrate) can seed the pipeline and the first window request
      // reports the held ranges instead of pulling the fresh render's bytes.
      this.#hydrateRenderFromDisk(manifest);
    }
    return true;
  }

  /**
   * Tail of setManifest: media creation, the join seek (reconnects align with
   * the host position), and the first window request. `seeded` is true when
   * init/clusters were adopted from a cache, which also means any init that
   * raced ahead of the manifest belongs to a superseded render and must not
   * be assembled.
   */
  #finishManifestSetup(manifest: MultiplayerRenderManifest, seeded: boolean): void {
    this.#createMediaSource();
    // An init that raced ahead of the manifest can be appended as soon as
    // sourceopen fires — unless a cache seeded a different render's init.
    if (!seeded && this.#pendingInitRenderId === manifest.renderId && this.#pendingInitFragments.size > 0) {
      const bytes = this.#assemblePendingInit();
      if (bytes) {
        this.#initBytes = bytes;
        this.#appendInit();
      }
    }
    // A fresh pipeline joining a generation already in flight (client
    // refresh / auto reconnect) must align with the host's current position
    // instead of starting from 0. The playback snapshot precedes the
    // manifest on the ordered channel, so the host position is known here.
    const joinTargetMs = this.#currentTargetMs();
    if (joinTargetMs > 0) {
      this.#performSeek(joinTargetMs);
    } else {
      this.#requestWindow(0);
    }
    this.#startStallDetector();
  }

  ingest(
    renderId: string,
    epoch: number,
    clusterIndex: number,
    offset: number,
    payload: ArrayBuffer
  ): void {
    if (!this.#manifest || this.#manifest.renderId !== renderId) {
      // The init rides the unordered render channel and can beat the manifest
      // (ordered control channel). Buffer its fragments instead of dropping
      // them; setManifest assembles them once it lands.
      if (clusterIndex === RENDER_INIT_CLUSTER_INDEX && !this.#initAppended) {
        if (this.#pendingInitRenderId !== null && this.#pendingInitRenderId !== renderId) return;
        this.#pendingInitRenderId = renderId;
        this.#pendingInitFragments.set(offset, new Uint8Array(payload));
      }
      return;
    }
    if (clusterIndex === RENDER_INIT_CLUSTER_INDEX) {
      if (this.#initAppended) return;
      const bytes = this.#assemble(this.#initBytes ?? undefined, clusterIndex, offset, payload);
      if (bytes) {
        this.#initBytes = bytes;
        this.#appendInit();
      }
      return;
    }
    if (epoch !== this.#epoch || clusterIndex >= this.#manifest.clusters.length) return;
    const bytes = this.#assemble(this.#received.get(clusterIndex), clusterIndex, offset, payload);
    if (!bytes) return;
    this.#received.set(clusterIndex, bytes);
    this.#receivedBytes += bytes.byteLength;
    this.#scheduleAppends();
  }

  syncPlayback(playback: MultiplayerPlayback): void {
    if (playback.generationId !== this.#generationId) return;
    const previous = this.#playback;
    this.#playback = playback;
    if (!this.#manifest) return;

    if (previous && hasTimelineDiscontinuity(previous, playback)) {
      this.#performSeek(expectedPositionMs(playback));
      return;
    }
    this.#applyHostState();
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) {
      this.setAudible(false);
      this.#element?.pause();
      return;
    }
    this.#applyHostState();
  }

  setAudible(audible: boolean): void {
    if (this.#audible === audible) return;
    this.#audible = audible;
    audioBusService.setSourceGain(this.#sourceNode, audible ? 1 : 0, 0.04);
  }

  resumeAudible(): void {
    void audioBusService.resume();
    if (this.#element) {
      void this.#element.play().catch(() => undefined);
    }
    this.setAudible(this.#enabled);
  }

  release(): void {
    // Session teardown still leaves the current render cacheable; a
    // reconnect to the same host reuses it.
    this.#cacheCurrentRender();
    this.#chainToken += 1;
    this.#chain = Promise.resolve();
    this.#stopMonitor();
    this.#stopStallDetector();
    this.#generationId = null;
    this.#trackId = null;
    this.#manifest = null;
    this.#epoch = 0;
    this.#ready = false;
    this.#rebuffering = false;
    this.#playback = null;
    this.#received.clear();
    this.#fragments.clear();
    this.#initBytes = null;
    this.#initAppended = false;
    this.#pendingInitRenderId = null;
    this.#pendingInitFragments.clear();
    this.#receivedBytes = 0;
    this.#audible = false;
    this.#releaseMedia();
  }

  /** Stores compressed bytes under their track/source revision/bitrate key. */
  #cacheCurrentRender(): void {
    const manifest = this.#manifest;
    if (!manifest || !this.#initBytes || this.#received.size === 0) return;
    const key = buildClientRenderCacheKey(
      manifest.trackId,
      manifest.sourceRevision,
      manifest.bitrateKbps
    );
    clientRenderCache.put(key, {
      manifest,
      init: this.#initBytes,
      clusters: new Map(this.#received)
    });
    // Mirror the same render into the cross-session IndexedDB cache so a
    // rejoin or later replay can skip the re-download. Best-effort: quota
    // failures and IDB errors are swallowed by the store.
    void multiplayerRenderDiskCache.put({
      key,
      name: this.#playback?.track?.name ?? manifest.trackId,
      manifest,
      init: this.#initBytes,
      clusters: new Map(this.#received)
    });
  }

  /** Returns an identity and structure matching render, or null to re-download. */
  #cachedRenderFor(
    manifest: MultiplayerRenderManifest
  ): { renderId: string; manifest: MultiplayerRenderManifest; init: Uint8Array; clusters: Map<number, Uint8Array>; bytes: number } | null {
    const exact = clientRenderCache.get(buildClientRenderCacheKey(
      manifest.trackId,
      manifest.sourceRevision,
      manifest.bitrateKbps
    ));
    if (exact && renderMatchesManifest(exact, manifest)) {
      let bytes = exact.init.byteLength;
      for (const cluster of exact.clusters.values()) bytes += cluster.byteLength;
      return {
        renderId: exact.manifest.renderId,
        manifest,
        init: exact.init,
        clusters: new Map(exact.clusters),
        bytes
      };
    }
    // The host lowered its bitrate: a complete cached render at a higher
    // bitrate is exactly what the host previously rendered, so it plays
    // without a re-download. The pipeline adopts that render's own manifest
    // (the bytes are self-describing; cluster sizes differ from the fresh
    // lower-bitrate table). Needs sent with the cached renderId are dropped
    // by the host, so no lower-bitrate bytes are ever requested.
    const higher = clientRenderCache.findHigherBitrate(
      manifest.trackId,
      manifest.sourceRevision,
      manifest.bitrateKbps
    );
    if (!higher || !renderLayoutMatches(higher.manifest, manifest)) return null;
    let higherBytes = higher.init.byteLength;
    for (const cluster of higher.clusters.values()) higherBytes += cluster.byteLength;
    return {
      renderId: higher.manifest.renderId,
      // The cached bytes use the cached render's structure, but the host's
      // current generation/render IDs remain authoritative for the wire
      // protocol and readiness acknowledgements.
      manifest: {
        ...higher.manifest,
        generationId: manifest.generationId,
        renderId: manifest.renderId
      },
      init: higher.init,
      clusters: new Map(higher.clusters),
      bytes: higherBytes
    };
  }

  /**
   * Seeds the pipeline from the cross-session IndexedDB cache when the
   * in-memory cache missed. The read resolves asynchronously, so it is
   * guarded against a generation teardown or a superseding render while in
   * flight. The normal network setup is deferred until the decision lands
   * (#finishManifestSetup), so a complete cached render (exact or higher
   * bitrate) is in place BEFORE the first window request — the host then sees
   * the held ranges and never sends the fresh render's bytes, which is also
   * what makes a higher-bitrate substitute safe (no two encodings can mix).
   */
  #hydrateRenderFromDisk(manifest: MultiplayerRenderManifest): void {
    const generationId = this.#generationId;
    const settle = (seeded: boolean): void => {
      if (this.#generationId !== generationId) return;
      if (this.#manifest?.renderId !== manifest.renderId) return;
      this.#finishManifestSetup(manifest, seeded);
    };
    void multiplayerRenderDiskCache.getMatching(
      manifest.trackId,
      manifest.sourceRevision,
      manifest.bitrateKbps
    ).then((found) => {
      if (this.#generationId !== generationId) return;
      if (this.#manifest?.renderId !== manifest.renderId) return;
      if (!found) {
        // Nothing usable on disk: proceed with the normal network flow.
        settle(false);
        return;
      }
      const { key, render: cached } = found;
      const higherBitrate = !renderMatchesManifest(cached, manifest);
      if (higherBitrate) {
        // The cached render's cluster sizes differ from the fresh manifest's,
        // so the pipeline adopts the cached manifest wholesale. Nothing has
        // been appended yet (media is created by #finishManifestSetup), so
        // any fresh init/cluster fragments that raced in are simply dropped.
        if (!renderLayoutMatches(cached.manifest, manifest)) {
          settle(false);
          return;
        }
        this.#manifest = {
          ...cached.manifest,
          generationId: manifest.generationId,
          renderId: manifest.renderId
        };
        this.#pendingInitRenderId = null;
        this.#pendingInitFragments.clear();
        this.#fragments.clear();
        let bytes = cached.init.byteLength;
        for (const cluster of cached.clusters.values()) bytes += cluster.byteLength;
        this.#initBytes = cached.init;
        this.#received = new Map(cached.clusters);
        this.#receivedBytes = bytes;
      } else {
        // Network bytes that raced ahead win; cached bytes fill the rest.
        const merged = new Map<number, Uint8Array>();
        for (const [index, bytes] of cached.clusters) merged.set(index, bytes);
        for (const [index, bytes] of this.#received) merged.set(index, bytes);
        let receivedBytes = 0;
        for (const bytes of merged.values()) receivedBytes += bytes.byteLength;
        const adoptCachedInit = !this.#initBytes && !this.#initAppended;
        if (adoptCachedInit) {
          this.#initBytes = cached.init;
          this.#pendingInitRenderId = null;
          this.#pendingInitFragments.clear();
          receivedBytes += cached.init.byteLength;
        }
        this.#received = merged;
        this.#receivedBytes = receivedBytes;
      }
      // Warm the in-memory cache under the key the bytes actually belong to,
      // so the next loop within this session is served synchronously.
      clientRenderCache.put(key, cached);
      logInfo('multiplayer', higherBitrate
        ? 'Buffered Opus disk cache hit (higher bitrate)'
        : 'Buffered Opus disk cache hit', {
        trackId: manifest.trackId,
        renderId: manifest.renderId,
        cachedBitrate: cached.manifest.bitrateKbps,
        hostBitrate: manifest.bitrateKbps,
        clusters: this.#received.size,
        bytes: this.#receivedBytes
      });
      settle(true);
    }).catch(() => {
      // The cache is best-effort: fall through to the network flow.
      settle(false);
    });
  }

  #assemble(
    existing: Uint8Array | undefined,
    clusterIndex: number,
    offset: number,
    payload: ArrayBuffer
  ): Uint8Array | null {
    const manifest = this.#manifest;
    if (!manifest) return null;
    const totalSize = clusterIndex === RENDER_INIT_CLUSTER_INDEX
      ? manifest.initSizeBytes
      : manifest.clusters[clusterIndex]?.sizeBytes;
    if (!totalSize) return null;

    if (existing && existing.byteLength === totalSize) return existing;
    let fragmentMap = this.#fragments.get(clusterIndex);
    if (!fragmentMap) {
      fragmentMap = new Map();
      this.#fragments.set(clusterIndex, fragmentMap);
    }
    fragmentMap.set(offset, new Uint8Array(payload));
    if (offset + payload.byteLength > totalSize) {
      this.#fragments.delete(clusterIndex);
      return null;
    }
    const bytes = new Uint8Array(totalSize);
    let filled = 0;
    for (const [fragmentOffset, fragment] of fragmentMap) {
      if (fragmentOffset + fragment.byteLength > totalSize) return null;
      bytes.set(fragment, fragmentOffset);
      filled += fragment.byteLength;
    }
    if (filled !== totalSize) return null;
    this.#fragments.delete(clusterIndex);
    return bytes;
  }

  #assemblePendingInit(): Uint8Array | null {
    const manifest = this.#manifest;
    if (!manifest) return null;
    const totalSize = manifest.initSizeBytes;
    const bytes = new Uint8Array(totalSize);
    let filled = 0;
    for (const [fragmentOffset, fragment] of this.#pendingInitFragments) {
      if (fragmentOffset + fragment.byteLength > totalSize) return null;
      bytes.set(fragment, fragmentOffset);
      filled += fragment.byteLength;
    }
    if (filled !== totalSize) return null;
    this.#pendingInitFragments.clear();
    this.#pendingInitRenderId = null;
    return bytes;
  }

  #appendInit(): void {
    this.#initAppended = false;
    this.#scheduleAppends();
  }

  #scheduleAppends(): void {
    if (!this.#manifest) return;
    // Retry the init from sourceopen as it can arrive before the SourceBuffer.
    if (!this.#initAppended) {
      if (this.#initBytes && this.#sourceBuffer) {
        this.#enqueue(() => {
          if (this.#initAppended || !this.#sourceBuffer || !this.#initBytes) return;
          this.#sourceBuffer.appendBuffer(this.#initBytes.buffer as ArrayBuffer);
          this.#initAppended = true;
        });
      }
      return;
    }
    while (this.#received.has(this.#nextAppendIndex)) {
      const index = this.#nextAppendIndex;
      const bytes = this.#received.get(index)!;
      this.#enqueue(() => {
        if (!this.#sourceBuffer || this.#sourceBuffer.updating) return;
        this.#sourceBuffer.appendBuffer(bytes.buffer as ArrayBuffer);
      });
      this.#nextAppendIndex += 1;
    }
  }

  #enqueue(step: () => void | Promise<void>): void {
    const token = this.#chainToken;
    this.#chain = this.#chain.then(async () => {
      if (token !== this.#chainToken || !this.#sourceBuffer) return;
      if (this.#sourceBuffer.updating) {
        await waitForUpdateEnd(this.#sourceBuffer);
      }
      if (token !== this.#chainToken || !this.#sourceBuffer) return;
      await step();
      if (token !== this.#chainToken || !this.#sourceBuffer) return;
      if (this.#sourceBuffer.updating) {
        await waitForUpdateEnd(this.#sourceBuffer);
      }
      this.#afterAppend();
    }).catch(() => undefined);
  }

  #afterAppend(): void {
    this.#lastProgressAt = Date.now();
    this.#checkReadiness();
    this.#applyHostState();
    // Self-propagating drain: an init append (or any cluster append) makes the
    // next received cluster eligible; keep pulling from #received in order.
    this.#scheduleAppends();
  }

  #checkReadiness(): void {
    if (this.#ready || !this.#manifest) return;
    const targetMs = this.#currentTargetMs();
    const bufferedMs = this.#bufferedMs();
    const remainingMs = Math.max(0, this.#manifest.durationMs - targetMs);
    // bufferedMs() already measures the contiguous window AHEAD of the element
    // position; only shave off the part where the element lags the target.
    const localMs = this.#element ? this.#element.currentTime * 1_000 : targetMs;
    const windowMs = Math.max(0, bufferedMs - Math.max(0, targetMs - localMs));
    const desiredMs = this.#desiredWindowMs();
    if (hasRequiredRenderWindow(windowMs, desiredMs, remainingMs)) {
      this.#ready = true;
      this.#rebuffering = false;
      logInfo('multiplayer', 'Buffered Opus ready', {
        generationId: this.#generationId,
        epoch: this.#epoch,
        windowMs: Math.round(windowMs),
        desiredMs: Math.round(desiredMs),
        remainingMs: Math.round(remainingMs)
      });
      this.#callbacks?.onReady(this.#epoch, Math.round(targetMs));
    }
  }

  #performSeek(targetMs: number): void {
    this.#epoch += 1;
    this.#ready = false;
    this.#rebuffering = false;
    // Move the element to the target immediately: bufferedMs() measures from
    // the element position, so a stale position would keep readiness from
    // re-arming after the new window appends (drift correction is ready-gated
    // too, so the element would freeze at the old position forever).
    const element = this.#element;
    if (element) {
      const duration = this.#manifest?.durationMs;
      const clamped = duration ? Math.min(targetMs, duration) / 1_000 : targetMs / 1_000;
      element.currentTime = Math.max(0, clamped);
    }
    // Partial fragments belong to the dropped epoch; the manifest stays.
    this.#fragments.clear();
    const manifest = this.#manifest;
    if (!manifest) return;
    const targetCluster = this.#clusterIndexForTime(targetMs);
    this.#nextAppendIndex = targetCluster;
    // Drop only what precedes the new position: buffered media from the seek
    // target onward is still valid (same render), so a backwards seek keeps
    // its future window and the seek bar never blanks while the gap
    // re-downloads. The retained compressed clusters re-append from memory.
    this.#chainToken += 1;
    this.#chain = Promise.resolve();
    const token = this.#chainToken;
    this.#chain = this.#chain.then(async () => {
      if (token !== this.#chainToken || !this.#sourceBuffer) return;
      const end = this.#sourceBuffer.buffered.length > 0
        ? this.#sourceBuffer.buffered.end(this.#sourceBuffer.buffered.length - 1)
        : 0;
      const removeTo = Math.min(Math.max(0, targetMs / 1_000), end);
      if (end > 0 && removeTo > 0) {
        this.#sourceBuffer.remove(0, removeTo);
        await waitForUpdateEnd(this.#sourceBuffer);
      }
    }).then(() => {
      this.#scheduleAppends();
    }).catch(() => undefined);

    logDebug('multiplayer', 'Buffered Opus seek epoch', {
      generationId: this.#generationId,
      epoch: this.#epoch,
      targetMs: Math.round(targetMs),
      targetCluster
    });
    this.#requestWindow(targetMs);
    this.#applyHostState();
  }

  #requestWindow(targetMs: number): void {
    const manifest = this.#manifest;
    if (!manifest) return;
    // Give every initial, seek, rebuffer, and recovery request a full grace
    // window before the stall detector can supersede its epoch.
    this.#lastProgressAt = Date.now();
    const ranges = compactClusterRanges(this.#received.keys());
    this.#callbacks?.onNeed({
      epoch: this.#epoch,
      targetTimeMs: Math.max(0, Math.round(targetMs)),
      aheadMs: this.#desiredWindowMs(),
      ranges
    });
  }

  #applyHostState(): void {
    if (!this.#manifest || !this.#enabled) return;
    const playback = this.#playback;
    if (!playback) return;
    const snapshot = playback.snapshot;
    const hostMs = expectedPositionMs(playback);
    const element = this.#element;
    const localMs = element ? element.currentTime * 1_000 : hostMs;

    if (snapshot.state === 'playing') {
      if (!this.#ready) return;
      if (this.#rebuffering) return;
      if (!element) return;
      // Caught the buffered edge: enter buffering and request the current host
      // position at urgent priority instead of accumulating permanent lag.
      const bufferedMs = this.#bufferedMs();
      // bufferedMs() is the contiguous window ahead of the element position;
      // rebuffer only when that window is genuinely exhausted (subtracting
      // localMs again made this fire spuriously past the halfway point:
      // end - 2*position < margin, stranding the pipeline in rebuffering).
      if (bufferedMs < REBUFFER_EDGE_MARGIN_MS
        && this.#manifest.durationMs - localMs > REBUFFER_EDGE_MARGIN_MS) {
        // Drop readiness so checkReadiness can re-arm once the new window
        // fills; leaving it true would strand the pipeline in buffering.
        this.#ready = false;
        this.#rebuffering = true;
        this.setAudible(false);
        logInfo('multiplayer', 'Buffered Opus rebuffering', {
          generationId: this.#generationId,
          hostMs: Math.round(hostMs),
          localMs: Math.round(localMs),
          bufferedMs: Math.round(bufferedMs)
        });
        this.#requestWindow(hostMs);
        return;
      }
      const drift = Math.abs(localMs - hostMs);
      if (drift > DRIFT_CORRECTION_THRESHOLD_MS && !documentHidden()) {
        logDebug('multiplayer', 'Buffered Opus drift corrected', {
          hostMs: Math.round(hostMs),
          localMs: Math.round(localMs)
        });
        element.currentTime = Math.max(0, hostMs / 1_000);
      }
      if (element.paused) {
        void element.play().catch(() => undefined);
      }
      this.setAudible(this.#audible);
      return;
    }
    if (element && !element.paused) element.pause();
  }

  #currentTargetMs(): number {
    const playback = this.#playback;
    if (playback) return expectedPositionMs(playback);
    return 0;
  }

  #desiredWindowMs(): number {
    const manifest = this.#manifest;
    if (!manifest) return 0;
    const durationMs = manifest.durationMs;
    // Window target from the host 'buffer' message or settings (set externally
    // via updateWindowMs); fall back to the manifest cluster duration * 3.
    return Math.max(manifest.clusterDurationMs * 2, Math.min(this.#windowMs > 0 ? this.#windowMs : 3_000, durationMs));
  }

  #windowMs = 0;

  updateWindowMs(windowMs: number): void {
    this.#windowMs = Math.max(0, windowMs);
  }

  #bufferedMs(): number {
    const element = this.#element;
    const manifest = this.#manifest;
    if (!element || !manifest) return 0;
    const positionMs = Math.max(0, element.currentTime * 1_000);
    const ranges = element.buffered;
    for (let index = 0; index < ranges.length; index += 1) {
      if (positionMs >= ranges.start(index) * 1_000 && positionMs <= ranges.end(index) * 1_000) {
        return (ranges.end(index) - positionMs / 1_000) * 1_000;
      }
    }
    return 0;
  }

  #bufferedRanges(): Array<[number, number]> {
    const element = this.#element;
    if (!element) return [];
    const ranges: Array<[number, number]> = [];
    for (let index = 0; index < element.buffered.length; index += 1) {
      ranges.push([
        Math.round(element.buffered.start(index) * 1_000),
        Math.round(element.buffered.end(index) * 1_000)
      ]);
    }
    return ranges;
  }

  #clusterIndexForTime(timeMs: number): number {
    const clusters = this.#manifest?.clusters ?? [];
    if (clusters.length === 0) return 0;
    let low = 0;
    let high = clusters.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (clusters[middle].timeMs <= timeMs) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  }

  #createMediaSource(): void {
    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/webm; codecs=opus')) {
      logDebug('multiplayer', 'Buffered Opus MediaSource unsupported');
      this.#manifest = null;
      return;
    }
    const element = document.createElement('audio');
    element.autoplay = true;
    // Chromium applies element mute to its MediaElementAudioSourceNode tap;
    // the shared graph therefore owns audibility through the source gain.
    element.preload = 'auto';
    element.setAttribute('playsinline', '');
    element.setAttribute('aria-hidden', 'true');
    element.style.position = 'fixed';
    element.style.width = '1px';
    element.style.height = '1px';
    element.style.opacity = '0';
    element.style.pointerEvents = 'none';
    document.body?.appendChild(element);
    this.#element = element;
    this.#sourceNode = audioBusService.connectHtmlMediaElement(element);
    audioBusService.setSourceGain(this.#sourceNode, 0);

    const mediaSource = new MediaSource();
    this.#mediaSource = mediaSource;
    this.#objectUrl = URL.createObjectURL(mediaSource);
    element.src = this.#objectUrl;

    mediaSource.addEventListener('sourceopen', () => {
      if (this.#mediaSource !== mediaSource || mediaSource.readyState !== 'open') return;
      try {
        this.#sourceBuffer = mediaSource.addSourceBuffer('audio/webm; codecs=opus');
        this.#sourceBuffer.mode = 'segments';
        this.#startMonitor();
        this.#scheduleAppends();
      } catch (error) {
        logDebug('multiplayer', 'Buffered Opus SourceBuffer failed', { error });
        this.#manifest = null;
        this.#releaseMedia();
      }
    });
    mediaSource.addEventListener('sourceended', () => {
      if (this.#mediaSource === mediaSource) this.#mediaSource = null;
    });
  }

  #startMonitor(): void {
    this.#stopMonitor();
    this.#monitorTimer = window.setInterval(() => {
      if (!this.#enabled || !this.#ready || !this.#playback) return;
      if (this.#playback.snapshot.state !== 'playing') return;
      this.#applyHostState();
    }, BUFFER_MONITOR_INTERVAL_MS);
  }

  #stopMonitor(): void {
    if (this.#monitorTimer !== null) window.clearInterval(this.#monitorTimer);
    this.#monitorTimer = null;
  }

  /**
   * Re-requests a missing window when the ascending append drain stalls.
   *
   * The drain appends clusters strictly ascending from #nextAppendIndex, so an
   * unfilled early hole (e.g. the initial batch was skipped because the render
   * channel was still opening, or early frames died in a transport blip) leaves
   * later clusters stuck in #received forever: no readiness, permanent throbber.
   * Bumping the epoch makes the host reset its sent set/queue; the re-request
   * then targets the first missing cluster so the host schedules exactly the
   * gap. The same path covers a never-arrived init segment.
   */
  #checkStallRecovery(): void {
    const manifest = this.#manifest;
    if (!renderStallRecoveryNeeded({
      ready: this.#ready,
      hasManifest: Boolean(manifest),
      initAppended: this.#initAppended,
      hasInitBytes: Boolean(this.#initBytes),
      received: this.#received,
      nextAppendIndex: this.#nextAppendIndex,
      clusterCount: manifest?.clusters.length ?? 0,
      lastProgressAgeMs: Date.now() - this.#lastProgressAt,
      graceMs: STALL_CHECK_INTERVAL_MS
    })) return;
    if (!manifest) return;
    this.#epoch += 1;
    // Partial fragments belong to the dropped epoch; the manifest stays.
    this.#fragments.clear();
    this.#requestWindow(renderGapRecoveryTargetMs(
      this.#nextAppendIndex,
      manifest.clusters.map((cluster) => cluster.timeMs),
      this.#currentTargetMs()
    ));
    logInfo('multiplayer', 'Buffered Opus gap recovery', {
      generationId: this.#generationId,
      epoch: this.#epoch,
      nextAppendIndex: this.#nextAppendIndex,
      receivedClusters: this.#received.size
    });
  }

  #startStallDetector(): void {
    if (this.#stallTimer !== null) return;
    this.#stallTimer = window.setInterval(() => this.#checkStallRecovery(), STALL_CHECK_INTERVAL_MS);
  }

  #stopStallDetector(): void {
    if (this.#stallTimer !== null) window.clearInterval(this.#stallTimer);
    this.#stallTimer = null;
  }

  #releaseMedia(): void {
    this.#chainToken += 1;
    this.#chain = Promise.resolve();
    this.#stopMonitor();
    this.#initAppended = false;
    this.#nextAppendIndex = 0;
    if (this.#sourceNode) audioBusService.disconnect(this.#sourceNode);
    this.#sourceNode = null;
    if (this.#element) {
      this.#element.pause();
      this.#element.removeAttribute('src');
      this.#element.load();
      this.#element.remove();
    }
    this.#element = null;
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = null;
    this.#sourceBuffer = null;
    this.#mediaSource = null;
    this.#audible = false;
  }
}

export const multiplayerRenderPlaybackService = new MultiplayerRenderPlaybackService();

export {
  expectedPositionMs,
  hasRequiredRenderWindow,
  hasTimelineDiscontinuity,
  contiguousMsAtPosition,
  renderGapRecoveryTargetMs,
  renderStallRecoveryNeeded
} from './multiplayer-render-playback-math';

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function waitForUpdateEnd(sourceBuffer: SourceBuffer): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      sourceBuffer.removeEventListener('updateend', finish);
      resolve();
    };
    sourceBuffer.addEventListener('updateend', finish);
  });
}
