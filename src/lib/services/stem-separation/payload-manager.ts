import { writable } from 'svelte/store';
import { inspectStemCapability } from './capability';
import { digestBytes } from './identity';
import { STEM_PAYLOAD } from './payload';
import {
  deleteOpfsFile,
  deleteRuntimeRecord,
  getRuntimeRecord,
  putRuntimeRecord,
  readOpfsFile,
  writeOpfsFile
} from './storage';
import type { StemGpuAdapterInfo, StemPayloadInstallProgress, StemRuntimeRecord } from './types';

const PAYLOAD_CHANNEL = 'izci.stem-separation.payload';
const initialProgress: StemPayloadInstallProgress = {
  state: 'idle',
  loadedBytes: 0,
  totalBytes: STEM_PAYLOAD.modelBytes
};

function runtimeMatchesPayload(record: StemRuntimeRecord | undefined): record is StemRuntimeRecord {
  return Boolean(
    record &&
      record.payloadVersion === STEM_PAYLOAD.version &&
      record.modelDigest === STEM_PAYLOAD.modelSha256 &&
      record.modelBytes === STEM_PAYLOAD.modelBytes &&
      record.runtimeDigest === STEM_PAYLOAD.runtimeSha256 &&
      record.runtimeBytes === STEM_PAYLOAD.runtimeBytes
  );
}

class StemPayloadManager {
  #store = writable<StemPayloadInstallProgress>(initialProgress);
  #state = initialProgress;
  #abortController: AbortController | null = null;
  #channel: BroadcastChannel | null = null;

  constructor() {
    this.#store.subscribe((state) => (this.#state = state));
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.#channel = new BroadcastChannel(PAYLOAD_CHANNEL);
      this.#channel.addEventListener('message', () => void this.refresh());
    }
    if (typeof window !== 'undefined') void this.refresh();
  }

  subscribe = this.#store.subscribe;

  getSnapshot(): StemPayloadInstallProgress {
    return this.#state;
  }

  async isInstalled(): Promise<boolean> {
    const runtime = await getRuntimeRecord();
    if (!runtimeMatchesPayload(runtime)) return false;
    try {
      const file = await readOpfsFile(runtime.opfsPath);
      return file.size === STEM_PAYLOAD.modelBytes;
    } catch {
      return false;
    }
  }

  async refresh(): Promise<void> {
    this.#publish({ ...initialProgress, state: 'checking' });
    const installed = await this.isInstalled().catch(() => false);
    const runtime = installed ? await getRuntimeRecord().catch(() => undefined) : undefined;
    this.#publish({
      ...initialProgress,
      state: installed ? 'installed' : 'idle',
      loadedBytes: installed ? STEM_PAYLOAD.modelBytes : 0,
      adapterInfo: runtime?.adapterInfo
    });
  }

  async install(): Promise<void> {
    if (this.#abortController) return;
    const capability = await inspectStemCapability();
    if (!capability.supported) {
      throw new Error(capability.reason ?? 'This device cannot run stem separation.');
    }

    const modelUrl = new URL(STEM_PAYLOAD.modelUrl, window.location.origin);
    if (modelUrl.origin !== window.location.origin) {
      throw new Error('The optional model must be downloaded from izci itself.');
    }

    this.#abortController = new AbortController();
    const signal = this.#abortController.signal;
    const opfsPath = `/stem-runtime/${STEM_PAYLOAD.version}/${STEM_PAYLOAD.modelSha256}.onnx`;
    try {
      await navigator.storage.persist().catch(() => false);
      this.#publish({ ...initialProgress, state: 'downloading' });
      const response = await fetch(modelUrl, { signal, cache: 'no-store' });
      if (!response.ok || !response.body) {
        throw new Error(
          response.status === 404
            ? 'The optional model is not present in this izci deployment.'
            : `Model download failed (${response.status}).`
        );
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loadedBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loadedBytes += value.byteLength;
        this.#publish({
          state: 'downloading',
          loadedBytes,
          totalBytes: STEM_PAYLOAD.modelBytes
        });
      }
      if (loadedBytes !== STEM_PAYLOAD.modelBytes) {
        throw new Error(
          `Model size mismatch: expected ${STEM_PAYLOAD.modelBytes} bytes, received ${loadedBytes}.`
        );
      }

      this.#publish({
        state: 'verifying',
        loadedBytes,
        totalBytes: STEM_PAYLOAD.modelBytes
      });
      const bytes = new Uint8Array(loadedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const digest = await digestBytes(bytes.buffer);
      if (digest !== STEM_PAYLOAD.modelSha256) {
        throw new Error('The downloaded model failed SHA-256 verification.');
      }
      await writeOpfsFile(opfsPath, bytes.buffer);

      this.#publish({
        state: 'validating',
        loadedBytes,
        totalBytes: STEM_PAYLOAD.modelBytes
      });
      const modelFile = await readOpfsFile(opfsPath);
      const { validateStemModel } = await import('./processor');
      const adapterInfo = await validateStemModel(await modelFile.arrayBuffer(), signal, (info) => {
        this.#publish({
          state: 'validating',
          loadedBytes,
          totalBytes: STEM_PAYLOAD.modelBytes,
          adapterInfo: info
        });
      });
      const now = Date.now();
      await putRuntimeRecord({
        id: 'current',
        payloadVersion: STEM_PAYLOAD.version,
        modelDigest: STEM_PAYLOAD.modelSha256,
        modelBytes: STEM_PAYLOAD.modelBytes,
        runtimeDigest: STEM_PAYLOAD.runtimeSha256,
        runtimeBytes: STEM_PAYLOAD.runtimeBytes,
        opfsPath,
        installedAt: now,
        lastVerifiedAt: now,
        adapterInfo
      });
      this.#publish({
        state: 'installed',
        loadedBytes,
        totalBytes: STEM_PAYLOAD.modelBytes,
        adapterInfo
      });
      this.#channel?.postMessage({ type: 'installed' });
    } catch (error) {
      await deleteOpfsFile(opfsPath).catch(() => undefined);
      await deleteRuntimeRecord().catch(() => undefined);
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.#publish(initialProgress);
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.#publish({
        ...initialProgress,
        state: 'error',
        message,
        adapterInfo: this.#state.adapterInfo
      });
      throw error;
    } finally {
      this.#abortController = null;
    }
  }

  cancel(): void {
    this.#abortController?.abort();
  }

  async verifyAdapter(): Promise<StemGpuAdapterInfo> {
    if (this.#abortController) throw new Error('A stem model operation is already running.');
    const runtime = await getRuntimeRecord();
    if (!runtimeMatchesPayload(runtime)) throw new Error('Install the stem model first.');

    this.#abortController = new AbortController();
    const signal = this.#abortController.signal;
    this.#publish({
      state: 'validating',
      loadedBytes: STEM_PAYLOAD.modelBytes,
      totalBytes: STEM_PAYLOAD.modelBytes,
      adapterInfo: runtime.adapterInfo
    });
    try {
      const modelFile = await readOpfsFile(runtime.opfsPath);
      const { validateStemModel } = await import('./processor');
      const adapterInfo = await validateStemModel(await modelFile.arrayBuffer(), signal, (info) => {
        this.#publish({
          state: 'validating',
          loadedBytes: STEM_PAYLOAD.modelBytes,
          totalBytes: STEM_PAYLOAD.modelBytes,
          adapterInfo: info
        });
      });
      await putRuntimeRecord({ ...runtime, adapterInfo, lastVerifiedAt: Date.now() });
      this.#publish({
        state: 'installed',
        loadedBytes: STEM_PAYLOAD.modelBytes,
        totalBytes: STEM_PAYLOAD.modelBytes,
        adapterInfo
      });
      this.#channel?.postMessage({ type: 'verified' });
      return adapterInfo;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        await this.refresh();
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.#publish({
        state: 'installed',
        loadedBytes: STEM_PAYLOAD.modelBytes,
        totalBytes: STEM_PAYLOAD.modelBytes,
        message,
        adapterInfo: runtime.adapterInfo
      });
      throw error;
    } finally {
      this.#abortController = null;
    }
  }

  async remove(): Promise<void> {
    this.cancel();
    const runtime = await getRuntimeRecord();
    if (runtime) await deleteOpfsFile(runtime.opfsPath).catch(() => undefined);
    await deleteRuntimeRecord();
    if ('caches' in globalThis) await caches.delete('izci-optional-stem-runtime-v1');
    this.#publish(initialProgress);
    this.#channel?.postMessage({ type: 'removed' });
  }

  #publish(state: StemPayloadInstallProgress): void {
    this.#store.set(state);
  }
}

export const stemPayloadManager = new StemPayloadManager();
