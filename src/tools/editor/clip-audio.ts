import { MODULE_EXTENSIONS } from '$lib/contracts/media-format';
import { logDebug, logError, logInfo } from '$lib/logging/api';
import { inferMediaExtension } from '$lib/media/format-policy';

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

function createCompatibleBuffer(source: AudioBuffer, length: number): AudioBuffer {
  return new AudioBuffer({
    length: Math.max(1, length),
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate
  });
}

export function sliceAudioBuffer(source: AudioBuffer, start: number, end: number): AudioBuffer {
  const readStart = Math.min(source.length, Math.max(0, Math.round(start * source.sampleRate)));
  const readEnd = Math.min(source.length, Math.max(readStart, Math.round(end * source.sampleRate)));
  const output = createCompatibleBuffer(source, readEnd - readStart);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    output.copyToChannel(source.getChannelData(channel).subarray(readStart, readEnd), channel);
  }
  return output;
}

export function replaceAudioBufferRange(
  source: AudioBuffer,
  start: number,
  end: number,
  replacement: AudioBuffer | null
): AudioBuffer {
  if (replacement && (
    replacement.sampleRate !== source.sampleRate
    || replacement.numberOfChannels !== source.numberOfChannels
  )) {
    throw new Error('Pasted audio must use the same sample rate and channel layout.');
  }

  const readStart = Math.min(source.length, Math.max(0, Math.round(start * source.sampleRate)));
  const readEnd = Math.min(source.length, Math.max(readStart, Math.round(end * source.sampleRate)));
  const replacementLength = replacement?.length ?? 0;
  const output = createCompatibleBuffer(source, source.length - (readEnd - readStart) + replacementLength);

  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const outputData = output.getChannelData(channel);
    outputData.set(source.getChannelData(channel).subarray(0, readStart), 0);
    if (replacement) outputData.set(replacement.getChannelData(channel), readStart);
    outputData.set(source.getChannelData(channel).subarray(readEnd), readStart + replacementLength);
  }
  return output;
}

export function materializeClip(source: AudioBuffer, state: ClipEditState): AudioBuffer {
  const frameCount = state.ranges.reduce(
    (total, range) => total + Math.max(0, Math.round((range.end - range.start) * source.sampleRate)),
    0
  );
  const output = new AudioBuffer({
    length: Math.max(frameCount, 1),
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate
  });
  let writeOffset = 0;

  for (const range of state.ranges) {
    const readStart = Math.max(0, Math.round(range.start * source.sampleRate));
    const readEnd = Math.min(source.length, Math.round(range.end * source.sampleRate));
    const length = Math.max(0, readEnd - readStart);

    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      output.getChannelData(channel).set(source.getChannelData(channel).subarray(readStart, readEnd), writeOffset);
    }

    writeOffset += length;
  }

  return output;
}

export function encodeWav(buffer: AudioBuffer, id3Chunk?: Uint8Array): Blob {
  const channelCount = Math.min(buffer.numberOfChannels, 2);
  const bytesPerSample = 2;
  const dataSize = buffer.length * channelCount * bytesPerSample;
  const paddedId3Size = id3Chunk ? id3Chunk.byteLength + (id3Chunk.byteLength % 2) : 0;
  const totalSize = 44 + dataSize + (id3Chunk ? 8 + paddedId3Size : 0);
  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };

  writeText(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.min(1, Math.max(-1, buffer.getChannelData(channel)[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  if (id3Chunk) {
    writeText(offset, 'id3 ');
    view.setUint32(offset + 4, id3Chunk.byteLength, true);
    bytes.set(id3Chunk, offset + 8);
  }

  return new Blob([bytes], { type: 'audio/wav' });
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
  const moduleBytes = await file.arrayBuffer();
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
      libopenmptUrl: new URL(
        import.meta.env.DEV
          ? '/src/lib/vendor/chiptune3/libopenmpt.worklet.js'
          : '/assets/libopenmpt.worklet.js',
        document.baseURI
      ).href,
      sampleRate: 48_000
    }, [moduleBytes]);
  });
}

export async function loadAudioFile(
  file: File,
  onProgress: (progress: AudioLoadProgress) => void = () => undefined,
  signal?: AbortSignal
): Promise<{ buffer: AudioBuffer; renderedModule: boolean; fromCache: boolean }> {
  const extension = inferMediaExtension(file.name);
  const isModule = MODULE_EXTENSIONS.includes(extension as (typeof MODULE_EXTENSIONS)[number]);
  logDebug('tools', 'Editor audio load started', { name: file.name, size: file.size, isModule });

  if (!isModule) {
    onProgress({ phase: 'decoding', progress: null, detail: 'Decoding audio' });
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      logInfo('tools', 'Editor audio decoded', { name: file.name, duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
      return { buffer, renderedModule: false, fromCache: false };
    } catch (error) {
      logError('tools', 'Editor audio decode failed', { name: file.name, error });
      throw error;
    } finally {
      void context.close();
    }
  }

  const key = fileCacheKey(file);
  const cached = moduleRenderCache.get(key);
  if (cached) {
    logDebug('tools', 'Editor module render cache hit', { name: file.name });
    return { buffer: cached, renderedModule: true, fromCache: true };
  }

  onProgress({ phase: 'rendering', progress: 0, detail: 'Preparing module renderer' });
  const buffer = await renderModuleOffline(file, extension, onProgress, signal);
  moduleRenderCache.set(key, buffer);
  logInfo('tools', 'Module rendered for editing', { name: file.name, duration: buffer.duration });
  return { buffer, renderedModule: true, fromCache: false };
}

export async function saveBlob(blob: Blob, suggestedName: string): Promise<void> {
  const pickerWindow = window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
  };

  if (pickerWindow.showSaveFilePicker) {
    const extension = `.${suggestedName.split('.').pop()?.toLowerCase() ?? 'bin'}`;
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'Audio file', accept: { [blob.type || 'application/octet-stream']: [extension] } }]
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
