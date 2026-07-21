import { writable } from 'svelte/store';
import type { PlaylistItem } from '$lib/types';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import { inspectStemCapability } from './capability';
import { createStemResultKey, createStemSourceQuickKey, digestBytes } from './identity';
import { STEM_PAYLOAD } from './payload';
import { stemPayloadManager } from './payload-manager';
import {
  clearResultCache,
  commitResult,
  deleteOpfsFile,
  deleteResult,
  findResultByQuickKey,
  getResult,
  getRuntimeRecord,
  pruneResultCache,
  readOpfsFile,
  sweepStemStorage,
  touchResult,
  writeOpfsFile
} from './storage';
import {
  STEM_PIPELINE_VERSION,
  STEM_RESULT_SCHEMA_VERSION,
  STEM_SAMPLE_RATE
} from './types';
import type { StemResultRecord, StemSeparationSnapshot } from './types';

const CACHE_CHANNEL = 'izci.stem-separation.cache';
const initialSnapshot: StemSeparationSnapshot = {
  enabled: false,
  trackId: null,
  status: 'hidden',
  progress: 0,
  mix: 0,
  playbackAsset: null
};

function isCurrentResult(record: StemResultRecord): boolean {
  return (
    record.modelDigest === STEM_PAYLOAD.modelSha256 &&
    record.runtimeDigest === STEM_PAYLOAD.runtimeSha256 &&
    record.pipelineVersion === STEM_PIPELINE_VERSION &&
    record.schemaVersion === STEM_RESULT_SCHEMA_VERSION
  );
}

class StemSeparationService {
  #store = writable<StemSeparationSnapshot>(initialSnapshot);
  #snapshot = initialSnapshot;
  #track: PlaylistItem | null = null;
  #lookupToken = 0;
  #abortController: AbortController | null = null;
  #result: StemResultRecord | null = null;
  #objectUrl: string | null = null;
  #channel: BroadcastChannel | null = null;
  #unsubscribeSettings: () => void;
  #unsubscribePayload: () => void;

  constructor() {
    this.#store.subscribe((snapshot) => (this.#snapshot = snapshot));
    this.#unsubscribeSettings = experimentalSettings.subscribe((settings) => {
      if (!settings.stemSeparation) this.cancel();
      void this.#resolveTrack();
    });
    this.#unsubscribePayload = stemPayloadManager.subscribe(() => void this.#resolveTrack());
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.#channel = new BroadcastChannel(CACHE_CHANNEL);
      this.#channel.addEventListener('message', () => void this.#resolveTrack());
    }
    if (typeof window !== 'undefined') void sweepStemStorage().then(() => this.#resolveTrack()).catch(() => undefined);
  }

  subscribe = this.#store.subscribe;

  getSnapshot(): StemSeparationSnapshot {
    return this.#snapshot;
  }

  setCurrentTrack(track: PlaylistItem | null): void {
    this.#track = track;
    void this.#resolveTrack();
  }

  setMix(value: number): void {
    const mix = Math.min(Math.max(Number.isFinite(value) ? value : 0, -1), 1);
    this.#publish({ ...this.#snapshot, mix });
  }

  async prepare(track: PlaylistItem, file: File): Promise<void> {
    if (this.#abortController) return;
    if (track.kind !== 'stream') throw new Error('Tracker modules are not eligible for stem separation.');
    this.#abortController = new AbortController();
    const signal = this.#abortController.signal;
    const quickKey = createStemSourceQuickKey(track);
    let finalPath: string | null = null;
    this.#publish({
      ...this.#snapshot,
      enabled: true,
      trackId: track.id,
      status: 'processing',
      progress: 0,
      playbackAsset: null,
      message: undefined
    });

    try {
      const capability = await inspectStemCapability();
      if (!capability.supported) throw new Error(capability.reason ?? 'WebGPU is unsupported.');
      if (!(await stemPayloadManager.isInstalled())) throw new Error('Install the stem model in Options first.');

      const estimate = await navigator.storage.estimate().catch((): StorageEstimate => ({}));
      const estimatedResultBytes = Math.ceil((track.metadata?.duration ?? 0) * STEM_SAMPLE_RATE * 8 + 44);
      if (
        estimate.quota &&
        estimate.usage !== undefined &&
        estimatedResultBytes > Math.max(estimate.quota - estimate.usage, 0)
      ) {
        throw new Error('There is not enough browser storage to prepare this track.');
      }

      await navigator.storage.persist().catch(() => false);
      const sourceBytes = await file.arrayBuffer();
      if (signal.aborted) throw new DOMException('Stem preparation was cancelled.', 'AbortError');
      const sourceDigest = await digestBytes(sourceBytes);
      const resultKey = await createStemResultKey(sourceDigest);
      const cached = await getResult(resultKey);
      if (cached && isCurrentResult(cached)) {
        await commitResult({ ...cached, sourceQuickKey: quickKey, lastAccessed: Date.now() });
        await this.#resolveTrack();
        return;
      }

      const runtime = await getRuntimeRecord();
      if (!runtime) throw new Error('The installed stem model could not be opened.');
      const model = await readOpfsFile(runtime.opfsPath);
      const { processStemAudio } = await import('./processor');
      const processed = await processStemAudio(
        sourceBytes,
        await model.arrayBuffer(),
        signal,
        (progress) => {
          if (this.#snapshot.trackId === track.id && this.#snapshot.status === 'processing') {
            this.#publish({ ...this.#snapshot, progress });
          }
        },
        (adapterInfo) => {
          if (this.#snapshot.trackId === track.id && this.#snapshot.status === 'processing') {
            this.#publish({ ...this.#snapshot, adapterInfo });
          }
        }
      );
      await pruneResultCache(processed.wav.byteLength);
      const finalEstimate = await navigator.storage.estimate().catch((): StorageEstimate => ({}));
      if (
        finalEstimate.quota &&
        finalEstimate.usage !== undefined &&
        processed.wav.byteLength > Math.max(finalEstimate.quota - finalEstimate.usage, 0)
      ) {
        throw new Error('There is not enough browser storage to save this prepared track.');
      }
      finalPath = `/stem-cache/results/${resultKey}.wav`;
      await writeOpfsFile(finalPath, processed.wav);
      const now = Date.now();
      const record: StemResultRecord = {
        key: resultKey,
        sourceDigest,
        sourceQuickKey: quickKey,
        modelDigest: STEM_PAYLOAD.modelSha256,
        runtimeDigest: STEM_PAYLOAD.runtimeSha256,
        pipelineVersion: STEM_PIPELINE_VERSION,
        schemaVersion: STEM_RESULT_SCHEMA_VERSION,
        opfsPath: finalPath,
        duration: processed.duration,
        sampleRate: STEM_SAMPLE_RATE,
        frameCount: processed.frameCount,
        byteSize: processed.wav.byteLength,
        peakTable: processed.peakTable,
        adapterInfo: processed.adapterInfo,
        createdAt: now,
        lastAccessed: now
      };
      await commitResult(record);
      finalPath = null;
      this.#channel?.postMessage({ type: 'result', quickKey });
      await this.#resolveTrack();
    } catch (error) {
      if (finalPath) await deleteOpfsFile(finalPath).catch(() => undefined);
      if (error instanceof DOMException && error.name === 'AbortError') {
        await this.#resolveTrack();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.#publish({ ...this.#snapshot, status: 'error', message, progress: 0 });
      throw error;
    } finally {
      this.#abortController = null;
    }
  }

  cancel(): void {
    this.#abortController?.abort();
  }

  async deleteCurrentResult(): Promise<void> {
    if (!this.#result) return;
    await deleteResult(this.#result);
    this.#channel?.postMessage({ type: 'deleted', key: this.#result.key });
    await this.#resolveTrack();
  }

  async clearResults(): Promise<void> {
    await clearResultCache();
    this.#channel?.postMessage({ type: 'cleared' });
    await this.#resolveTrack();
  }

  destroy(): void {
    this.cancel();
    this.#unsubscribeSettings();
    this.#unsubscribePayload();
    this.#channel?.close();
    this.#revokeObjectUrl();
  }

  async #resolveTrack(): Promise<void> {
    const token = ++this.#lookupToken;
    const enabled = experimentalSettings.getSnapshot().stemSeparation;
    const track = this.#track;
    this.#result = null;
    if (this.#snapshot.playbackAsset) {
      this.#publish({ ...this.#snapshot, playbackAsset: null });
    }
    this.#revokeObjectUrl();

    if (!enabled) {
      this.#publish({ ...initialSnapshot, mix: this.#snapshot.mix });
      return;
    }
    if (!track) {
      this.#publish({ ...initialSnapshot, enabled: true, status: 'unprepared', mix: this.#snapshot.mix });
      return;
    }
    this.#publish({
      ...initialSnapshot,
      enabled: true,
      trackId: track.id,
      status: 'checking',
      mix: this.#snapshot.mix,
      adapterInfo: stemPayloadManager.getSnapshot().adapterInfo
    });
    const capability = await inspectStemCapability();
    if (token !== this.#lookupToken) return;
    if (!capability.supported) {
      this.#publish({ ...this.#snapshot, status: 'unsupported', message: capability.reason });
      return;
    }
    if (!(await stemPayloadManager.isInstalled())) {
      if (token === this.#lookupToken) this.#publish({ ...this.#snapshot, status: 'setup-required' });
      return;
    }
    if (track.kind !== 'stream') {
      this.#publish({
        ...this.#snapshot,
        status: 'ineligible',
        message: 'Tracker modules are not eligible for stem separation.'
      });
      return;
    }
    const result = await findResultByQuickKey(createStemSourceQuickKey(track));
    if (token !== this.#lookupToken) return;
    if (!result || !isCurrentResult(result)) {
      this.#publish({ ...this.#snapshot, status: 'unprepared' });
      return;
    }
    try {
      const touched = await touchResult(result);
      const file = await readOpfsFile(touched.opfsPath);
      if (token !== this.#lookupToken) return;
      this.#result = touched;
      this.#objectUrl = URL.createObjectURL(file);
      this.#publish({
        ...this.#snapshot,
        status: 'ready',
        progress: 1,
        message: undefined,
        adapterInfo: touched.adapterInfo ?? stemPayloadManager.getSnapshot().adapterInfo,
        playbackAsset: {
          url: this.#objectUrl,
          cacheKey: touched.key,
          peakTable: touched.peakTable
        }
      });
    } catch {
      this.#publish({
        ...this.#snapshot,
        status: 'error',
        message: 'The cached vocal asset could not be opened.'
      });
    }
  }

  #publish(snapshot: StemSeparationSnapshot): void {
    this.#store.set(snapshot);
  }

  #revokeObjectUrl(): void {
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = null;
  }
}

export const stemSeparationService = new StemSeparationService();
