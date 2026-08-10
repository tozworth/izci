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
  renderMatchesManifest
} from './multiplayer-render-client-cache';
import { compactClusterRanges } from './multiplayer-render-scheduler';
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

const REBUFFER_EDGE_MARGIN_MS = 600;
const DRIFT_CORRECTION_THRESHOLD_MS = 1_000;
const BUFFER_MONITOR_INTERVAL_MS = 500;
/** Cadence for re-requesting a stalled startup/gap window. */
const STALL_CHECK_INTERVAL_MS = 2_500;

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
  #lastAppendAt = 0;
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
      buffering: this.#rebuffering || (!this.#ready && Boolean(this.#manifest)),
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
    // A matching track/source revision/bitrate can skip the re-download.
    const cached = this.#cachedRenderFor(manifest);
    if (cached) {
      this.#initBytes = cached.init;
      this.#received = cached.clusters;
      this.#receivedBytes = cached.bytes;
      this.#nextAppendIndex = 0;
      this.#pendingInitRenderId = null;
      this.#pendingInitFragments.clear();
      logInfo('multiplayer', 'Buffered Opus client cache hit', {
        trackId: manifest.trackId,
        renderId: manifest.renderId,
        cachedRenderId: cached.renderId,
        clusters: cached.clusters.size,
        bytes: cached.bytes
      });
    }
    this.#createMediaSource();
    // An init that raced ahead of the manifest can be appended as soon as
    // sourceopen fires.
    if (!cached && this.#pendingInitRenderId === manifest.renderId && this.#pendingInitFragments.size > 0) {
      const bytes = this.#assemblePendingInit();
      if (bytes) {
        this.#initBytes = bytes;
        this.#appendInit();
      }
    }
    this.#startStallDetector();
    return true;
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
    clientRenderCache.put(buildClientRenderCacheKey(
      manifest.trackId,
      manifest.sourceRevision,
      manifest.bitrateKbps
    ), {
      manifest,
      init: this.#initBytes,
      clusters: new Map(this.#received)
    });
  }

  /** Returns an identity and structure matching render, or null to re-download. */
  #cachedRenderFor(
    manifest: MultiplayerRenderManifest
  ): { renderId: string; init: Uint8Array; clusters: Map<number, Uint8Array>; bytes: number } | null {
    const cached = clientRenderCache.get(buildClientRenderCacheKey(
      manifest.trackId,
      manifest.sourceRevision,
      manifest.bitrateKbps
    ));
    if (!cached || !renderMatchesManifest(cached, manifest)) return null;
    let bytes = cached.init.byteLength;
    for (const cluster of cached.clusters.values()) bytes += cluster.byteLength;
    return {
      renderId: cached.manifest.renderId,
      init: cached.init,
      clusters: new Map(cached.clusters),
      bytes
    };
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
    this.#lastAppendAt = Date.now();
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
    // Clear the buffered pipeline so the new window appends cleanly; the
    // retained compressed clusters re-appear instantly from local memory.
    this.#chainToken += 1;
    this.#chain = Promise.resolve();
    const token = this.#chainToken;
    this.#chain = this.#chain.then(async () => {
      if (token !== this.#chainToken || !this.#sourceBuffer) return;
      const end = this.#sourceBuffer.buffered.length > 0
        ? this.#sourceBuffer.buffered.end(this.#sourceBuffer.buffered.length - 1)
        : 0;
      if (end > 0) {
        this.#sourceBuffer.remove(0, end);
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
    this.#requestWindow(0);
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
      lastAppendAgeMs: Date.now() - this.#lastAppendAt,
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

export function expectedPositionMs(playback: MultiplayerPlayback): number {
  const elapsed = playback.snapshot.state === 'playing'
    ? Math.max(0, (Date.now() - playback.sentAt))
    : 0;
  const durationMs = playback.snapshot.duration > 0
    ? playback.snapshot.duration * 1_000
    : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(playback.snapshot.currentTime * 1_000 + elapsed, 0), durationMs);
}

export function hasTimelineDiscontinuity(
  previous: MultiplayerPlayback,
  next: MultiplayerPlayback
): boolean {
  if (!previous.track || !next.track || previous.track.id !== next.track.id) return false;
  if (previous.generationId !== next.generationId) return true;
  return Math.abs(expectedPositionMs(previous) - expectedPositionMs(next)) > 1_000;
}

export function contiguousMsAtPosition(
  ranges: Array<{ start: number; end: number }>,
  positionMs: number
): number {
  for (const range of ranges) {
    if (positionMs >= range.start && positionMs <= range.end) {
      return range.end - positionMs;
    }
  }
  return 0;
}

export function hasRequiredRenderWindow(
  windowMs: number,
  desiredMs: number,
  remainingMs: number
): boolean {
  return Math.max(0, windowMs) >= Math.min(
    Math.max(0, desiredMs),
    Math.max(0, remainingMs)
  );
}

/**
 * Whether the append pipeline needs a gap re-request.
 *
 * The drain appends clusters strictly ascending from #nextAppendIndex, so an
 * unfilled early hole strands later received clusters forever (no readiness,
 * permanent throbber). A re-request is warranted only when appends have made
 * NO progress for the grace window AND the drain cannot advance (the missing
 * next cluster, or the init itself never arrived). A healthy transfer keeps
 * appending every few hundred ms, so the progress-age gate prevents firing
 * during ordinary progressive downloads and frontier waits.
 */
export function renderStallRecoveryNeeded(input: {
  ready: boolean;
  hasManifest: boolean;
  initAppended: boolean;
  hasInitBytes: boolean;
  received: ReadonlyMap<number, unknown>;
  nextAppendIndex: number;
  clusterCount: number;
  lastAppendAgeMs: number;
  graceMs: number;
}): boolean {
  if (input.ready || !input.hasManifest) return false;
  // The init itself never arrived: nothing can append.
  if (!input.initAppended && !input.hasInitBytes) return true;
  // Appends progressed recently: the transfer is alive, just catching up.
  if (input.lastAppendAgeMs < input.graceMs) return false;
  // Nothing left to drain.
  if (input.nextAppendIndex >= input.clusterCount) return false;
  return !input.received.has(input.nextAppendIndex);
}

/**
 * Re-request target for a stalled append drain: the time of the first missing
 * cluster (the gap), falling back to the current playhead past the end.
 */
export function renderGapRecoveryTargetMs(
  nextAppendIndex: number,
  clusterTimeMs: number[],
  fallbackMs: number
): number {
  return nextAppendIndex < clusterTimeMs.length
    ? clusterTimeMs[nextAppendIndex]
    : Math.max(0, fallbackMs);
}

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
