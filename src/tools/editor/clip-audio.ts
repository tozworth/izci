import { saveFile } from '$lib/services/file-access';
import { MODULE_EXTENSIONS } from '$lib/types';
import { logDebug, logError, logInfo } from '$lib/services/logging';
import { inferExtension } from '$lib/utils/files';

export interface ClipRange {
  start: number;
  end: number;
}

export interface ClipEditState {
  ranges: ClipRange[];
  selectionStart: number;
  selectionEnd: number;
}

export interface AudioLoadProgress {
  phase: 'decoding' | 'rendering';
  progress: number | null;
  detail: string;
}

const moduleRenderCache = new Map<string, AudioBuffer>();
const MODULE_CACHE_BYTES = 128 * 1024 * 1024;

function rememberModuleRender(key: string, buffer: AudioBuffer): void {
  const bytes = (value: AudioBuffer) => value.length * value.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  if (bytes(buffer) > MODULE_CACHE_BYTES) return;
  moduleRenderCache.delete(key);
  let retained = [...moduleRenderCache.values()].reduce((total, value) => total + bytes(value), 0);
  while (moduleRenderCache.size >= 2 || retained + bytes(buffer) > MODULE_CACHE_BYTES) {
    const oldest = moduleRenderCache.entries().next().value;
    if (!oldest) break;
    retained -= bytes(oldest[1]);
    moduleRenderCache.delete(oldest[0]);
  }
  moduleRenderCache.set(key, buffer);
}

function fileCacheKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

export function clipDuration(state: ClipEditState): number {
  return state.ranges.reduce((total, range) => total + Math.max(0, range.end - range.start), 0);
}

export function createInitialClipState(duration: number): ClipEditState {
  const safeDuration = Math.max(0, duration);
  return {
    ranges: safeDuration > 0 ? [{ start: 0, end: safeDuration }] : [],
    selectionStart: 0,
    selectionEnd: safeDuration
  };
}

export function updateSelection(state: ClipEditState, start: number, end: number): ClipEditState {
  const duration = clipDuration(state);
  const safeStart = Math.min(Math.max(Math.min(start, end), 0), duration);
  const safeEnd = Math.min(Math.max(Math.max(start, end), safeStart), duration);
  return { ...state, selectionStart: safeStart, selectionEnd: safeEnd };
}

export function sliceClipRanges(ranges: ClipRange[], start: number, end: number): ClipRange[] {
  const next: ClipRange[] = [];
  let cursor = 0;

  for (const range of ranges) {
    const length = range.end - range.start;
    const overlapStart = Math.max(start, cursor);
    const overlapEnd = Math.min(end, cursor + length);

    if (overlapEnd > overlapStart) {
      next.push({
        start: range.start + overlapStart - cursor,
        end: range.start + overlapEnd - cursor
      });
    }

    cursor += length;
  }

  return next;
}

export function keepSelection(state: ClipEditState): ClipEditState {
  const ranges = sliceClipRanges(state.ranges, state.selectionStart, state.selectionEnd);
  const duration = ranges.reduce((total, range) => total + range.end - range.start, 0);
  return { ranges, selectionStart: 0, selectionEnd: duration };
}

export function cutSelection(state: ClipEditState): ClipEditState {
  const duration = clipDuration(state);
  const ranges = [
    ...sliceClipRanges(state.ranges, 0, state.selectionStart),
    ...sliceClipRanges(state.ranges, state.selectionEnd, duration)
  ];
  const nextDuration = ranges.reduce((total, range) => total + range.end - range.start, 0);
  const cursor = Math.min(state.selectionStart, nextDuration);
  return { ranges, selectionStart: cursor, selectionEnd: cursor };
}

export function replaceSelectionRanges(state: ClipEditState, insertedRanges: ClipRange[]): ClipEditState {
  const duration = clipDuration(state);
  const insertionDuration = insertedRanges.reduce(
    (total, range) => total + Math.max(0, range.end - range.start),
    0
  );
  const ranges = [
    ...sliceClipRanges(state.ranges, 0, state.selectionStart),
    ...insertedRanges.map((range) => ({ ...range })),
    ...sliceClipRanges(state.ranges, state.selectionEnd, duration)
  ];
  return {
    ranges,
    selectionStart: state.selectionStart,
    selectionEnd: state.selectionStart + insertionDuration
  };
}

interface ModuleRenderWorkerMessage {
  type: 'progress' | 'complete' | 'error';
  progress?: number | null;
  renderedFrames?: number;
  totalFrames?: number;
  sampleRate?: number;
  left?: ArrayBuffer;
  right?: ArrayBuffer;
  message?: string;
}

async function renderModuleOffline(
  file: File,
  extension: string,
  onProgress: (progress: AudioLoadProgress) => void,
  signal?: AbortSignal
): Promise<AudioBuffer> {
  signal?.throwIfAborted();
  const moduleBytes = await file.arrayBuffer();
  signal?.throwIfAborted();
  const renderer = new Worker(new URL('./module-render.worker.ts', import.meta.url), { type: 'module' });

  return await new Promise<AudioBuffer>((resolve, reject) => {
    const handleAbort = () => {
      finish();
      reject(new DOMException('Module rendering cancelled.', 'AbortError'));
    };
    const finish = () => {
      renderer.terminate();
      signal?.removeEventListener('abort', handleAbort);
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    renderer.onerror = () => {
      finish();
      logError('tools', 'Offline module renderer failed to start', { name: file.name });
      reject(new Error('The offline module renderer failed to start.'));
    };
    renderer.onmessage = (event: MessageEvent<ModuleRenderWorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        const renderedSeconds = (message.renderedFrames ?? 0) / 48_000;
        const totalSeconds = (message.totalFrames ?? 0) / 48_000;
        onProgress({
          phase: 'rendering',
          progress: message.progress ?? null,
          detail: totalSeconds > 0
            ? `${renderedSeconds.toFixed(0)} / ${totalSeconds.toFixed(0)} s`
            : `${renderedSeconds.toFixed(0)} s`
        });
        return;
      }
      if (message.type === 'error') {
        finish();
        logError('tools', 'Offline module rendering failed', { name: file.name, message: message.message });
        reject(new Error(message.message ?? 'Module rendering failed.'));
        return;
      }
      if (message.type === 'complete' && message.left && message.right && message.sampleRate) {
        const left = new Float32Array(message.left);
        const right = new Float32Array(message.right);
        const buffer = new AudioBuffer({
          length: Math.max(1, Math.min(left.length, right.length)),
          numberOfChannels: 2,
          sampleRate: message.sampleRate
        });
        buffer.copyToChannel(left, 0);
        buffer.copyToChannel(right, 1);
        finish();
        resolve(buffer);
      }
    };
    renderer.postMessage({
      type: 'render',
      extension,
      module: moduleBytes,
      hivelyWasmUrl: new URL('/vendor/hively-replay.wasm', document.baseURI).href,
      sampleRate: 48_000
    }, [moduleBytes]);
  });
}

export async function loadAudioFile(
  file: File,
  onProgress: (progress: AudioLoadProgress) => void = () => undefined,
  signal?: AbortSignal
): Promise<{ buffer: AudioBuffer; renderedModule: boolean; fromCache: boolean }> {
  signal?.throwIfAborted();
  const extension = inferExtension(file.name);
  const isModule = MODULE_EXTENSIONS.includes(extension as (typeof MODULE_EXTENSIONS)[number]);
  logDebug('tools', 'Editor audio load started', { name: file.name, size: file.size, isModule });

  if (!isModule) {
    onProgress({ phase: 'decoding', progress: null, detail: 'Decoding audio' });
    const context = new AudioContext();
    try {
      const bytes = await file.arrayBuffer();
      signal?.throwIfAborted();
      const buffer = await context.decodeAudioData(bytes);
      signal?.throwIfAborted();
      logInfo('tools', 'Editor audio decoded', { name: file.name, duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
      return { buffer, renderedModule: false, fromCache: false };
    } catch (error) {
      if (signal?.aborted) throw error;
      logError('tools', 'Editor audio decode failed', { name: file.name, error });
      throw error;
    } finally {
      void context.close();
    }
  }

  const key = fileCacheKey(file);
  const cached = moduleRenderCache.get(key);
  if (cached) {
    // Refresh the bounded session LRU without copying PCM.
    moduleRenderCache.delete(key);
    moduleRenderCache.set(key, cached);
    logDebug('tools', 'Editor module render cache hit', { name: file.name });
    return { buffer: cached, renderedModule: true, fromCache: true };
  }

  onProgress({ phase: 'rendering', progress: 0, detail: 'Preparing module renderer' });
  const buffer = await renderModuleOffline(file, extension, onProgress, signal);
  signal?.throwIfAborted();
  rememberModuleRender(key, buffer);
  logInfo('tools', 'Module rendered for editing', { name: file.name, duration: buffer.duration });
  return { buffer, renderedModule: true, fromCache: false };
}

export async function saveBlob(blob: Blob, suggestedName: string): Promise<void> {
  const extension = `.${suggestedName.split('.').pop()?.toLowerCase() ?? 'bin'}`;
  await saveFile(blob, { suggestedName, types: [{ description: 'Audio file', accept: { [blob.type || 'application/octet-stream']: [extension] } }] });
}
