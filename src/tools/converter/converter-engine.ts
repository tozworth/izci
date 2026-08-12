import {
  Quality,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec
} from 'mediabunny';
import { logError, logInfo } from '$lib/services/logging';
import { MODULE_EXTENSIONS } from '$lib/contracts/media-format';
import { inferExtension } from '$lib/utils/files';
import { loadAudioFile } from '../editor/clip-audio';
import type { ConverterSettings } from './converter-options';

export interface ConverterProgress {
  phase: 'rendering' | 'converting';
  progress: number | null;
}

export interface ConverterCapabilities {
  audio: Partial<Record<AudioCodec, boolean>>;
  video: Partial<Record<VideoCodec, boolean>>;
}

type WorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'complete'; buffer: ArrayBuffer; mimeType: string }
  | { type: 'error'; message: string };

const AUDIO_CODECS_TO_PROBE: readonly AudioCodec[] = ['aac', 'opus', 'mp3', 'vorbis', 'flac', 'ac3', 'eac3'];
const VIDEO_CODECS_TO_PROBE: readonly VideoCodec[] = ['avc', 'hevc', 'vp9', 'av1', 'vp8', 'prores'];

async function registerFallbackEncoders(): Promise<void> {
  if (!await canEncodeAudio('mp3')) {
    const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
    registerMp3Encoder();
  }
  if (!await canEncodeAudio('flac')) {
    const { registerFlacEncoder } = await import('@mediabunny/flac-encoder');
    registerFlacEncoder();
  }
}

export async function detectConverterCapabilities(): Promise<ConverterCapabilities> {
  await registerFallbackEncoders();
  const audioEntries = await Promise.all(AUDIO_CODECS_TO_PROBE.map(async (codec) => {
    try {
      return [codec, await canEncodeAudio(codec, {
        numberOfChannels: 2,
        sampleRate: 48_000,
        quality: codec === 'flac' ? undefined : new Quality({ bitrate: 192_000 })
      })] as const;
    } catch {
      return [codec, false] as const;
    }
  }));
  const videoEntries = await Promise.all(VIDEO_CODECS_TO_PROBE.map(async (codec) => {
    try {
      return [codec, await canEncodeVideo(codec, {
        width: 1280,
        height: 720,
        quality: new Quality({ bitrate: 4_000_000 })
      })] as const;
    } catch {
      return [codec, false] as const;
    }
  }));
  return {
    audio: Object.fromEntries(audioEntries),
    video: Object.fromEntries(videoEntries)
  };
}

function abortError(): DOMException {
  return new DOMException('Conversion cancelled.', 'AbortError');
}

function runWorker(
  message: Record<string, unknown>,
  transfer: Transferable[],
  signal: AbortSignal,
  onProgress: (progress: ConverterProgress) => void
): Promise<Blob> {
  const worker = new Worker(new URL('./converter.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      worker.terminate();
      signal.removeEventListener('abort', handleAbort);
    };
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      finish();
      reject(abortError());
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) {
      handleAbort();
      return;
    }
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      finish();
      logError('tools', 'Conversion worker failed to start');
      reject(new Error('The conversion worker failed to start.'));
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (settled) return;
      const response = event.data;
      if (response.type === 'progress') {
        onProgress({ phase: 'converting', progress: response.progress });
        return;
      }
      settled = true;
      finish();
      if (response.type === 'error') {
        logError('tools', 'Conversion failed in worker', { message: response.message });
        reject(new Error(response.message));
      } else {
        resolve(new Blob([response.buffer], { type: response.mimeType }));
      }
    };
    worker.postMessage(message, transfer);
  });
}

export async function convertMediaFile(
  file: File,
  settings: ConverterSettings,
  signal: AbortSignal,
  onProgress: (progress: ConverterProgress) => void = () => undefined
): Promise<Blob> {
  const extension = inferExtension(file.name);
  const isModule = MODULE_EXTENSIONS.includes(extension as (typeof MODULE_EXTENSIONS)[number]);
  logInfo('tools', 'Conversion started', { name: file.name, size: file.size, isModule });
  if (!isModule) {
    const output = await runWorker({ type: 'convert-file', file, settings }, [], signal, onProgress);
    logInfo('tools', 'Conversion completed', { name: file.name, bytes: output.size });
    return output;
  }

  const loaded = await loadAudioFile(file, (progress) => {
    onProgress({ phase: 'rendering', progress: progress.progress });
  }, signal);
  if (signal.aborted) throw abortError();
  const channels = Array.from({ length: loaded.buffer.numberOfChannels }, (_, channel) =>
    loaded.buffer.getChannelData(channel).slice().buffer
  );
  const output = await runWorker({
    type: 'convert-pcm',
    channels,
    sampleRate: loaded.buffer.sampleRate,
    sourceName: file.name,
    settings
  }, channels, signal, onProgress);
  logInfo('tools', 'Conversion completed', { name: file.name, bytes: output.size });
  return output;
}

export async function runConcurrent<T>(
  items: readonly T[],
  parallelism: number,
  signal: AbortSignal,
  run: (item: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(parallelism)), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await run(items[index], index);
    }
  }));
}
