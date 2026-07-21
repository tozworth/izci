import type { StemWorkerRequest, StemWorkerResponse } from './processor-protocol';
import type { StemGpuAdapterInfo, StemPeakPoint } from './types';

export const MAX_STEM_DURATION_SECONDS = 12 * 60;

function runWorker<T>(
  request: StemWorkerRequest,
  transfers: Transferable[],
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
  onAdapter?: (adapterInfo: StemGpuAdapterInfo) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./processor.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Stem preparation was cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.addEventListener('message', (event: MessageEvent<StemWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress?.(message.progress);
        return;
      }
      if (message.type === 'adapter') {
        onAdapter?.(message.adapterInfo);
        return;
      }
      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.message));
        return;
      }
      cleanup();
      resolve(message as T);
    });
    worker.addEventListener('error', (event) => {
      cleanup();
      reject(new Error(event.message || 'Stem processing worker failed.'));
    });
    worker.postMessage(request, transfers);
  });
}

export async function validateStemModel(
  model: ArrayBuffer,
  signal?: AbortSignal,
  onAdapter?: (adapterInfo: StemGpuAdapterInfo) => void
): Promise<StemGpuAdapterInfo> {
  const response = await runWorker<Extract<StemWorkerResponse, { type: 'validated' }>>(
    { type: 'validate', model },
    [model],
    signal,
    undefined,
    onAdapter
  );
  return response.adapterInfo;
}

export interface ProcessStemAudioResult {
  wav: ArrayBuffer;
  peakTable: StemPeakPoint[];
  frameCount: number;
  duration: number;
  adapterInfo: StemGpuAdapterInfo;
}

export async function processStemAudio(
  sourceBytes: ArrayBuffer,
  model: ArrayBuffer,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  onAdapter?: (adapterInfo: StemGpuAdapterInfo) => void
): Promise<ProcessStemAudioResult> {
  const context = new OfflineAudioContext(2, 1, 44_100);
  const decoded = await context.decodeAudioData(sourceBytes);
  if (decoded.duration > MAX_STEM_DURATION_SECONDS) {
    throw new Error(`Tracks longer than ${MAX_STEM_DURATION_SECONDS / 60} minutes are not supported yet.`);
  }
  const totalSamples = decoded.length;
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);
  left.set(decoded.getChannelData(0));
  right.set(decoded.getChannelData(Math.min(1, decoded.numberOfChannels - 1)));
  const response = await runWorker<Extract<StemWorkerResponse, { type: 'complete' }>>(
    {
      type: 'process',
      model,
      left: left.buffer,
      right: right.buffer,
      totalSamples
    },
    [model, left.buffer, right.buffer],
    signal,
    onProgress,
    onAdapter
  );
  return {
    wav: response.wav,
    peakTable: response.peakTable,
    frameCount: response.frameCount,
    duration: response.frameCount / 44_100,
    adapterInfo: response.adapterInfo
  };
}
