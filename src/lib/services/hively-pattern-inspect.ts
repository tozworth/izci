import { createHivelyPatternSong, type HivelyPatternData } from './hively-patterns';

export interface HivelyInspectionMetadata {
  title: string;
  channels: number;
  subsongs: number;
  instruments: number;
  orders: number;
  duration: number;
}

export interface HivelyInspectionResult {
  song: import('$lib/types').ModulePatternSong;
  metadata: HivelyInspectionMetadata;
  data: HivelyPatternData;
}

interface HivelyInspectExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  ahx_init(): void;
  malloc(bytes: number): number;
  free(pointer: number): void;
  ahx_load(pointer: number, bytes: number, sampleRate: number, stereo: number): number;
  ahx_unload(): void;
  ahx_select_subsong(subsong: number): number;
  ahx_duration_frames(): number;
  ahx_subsong_count(): number;
  ahx_channel_count(): number;
  ahx_instrument_count(): number;
  ahx_order_count(): number;
  ahx_title(): number;
  ahx_track_length(): number;
  ahx_track_count(): number;
  ahx_position_track(position: number, channel: number): number;
  ahx_position_transpose(position: number, channel: number): number;
  ahx_step_note(track: number, row: number): number;
  ahx_step_instrument(track: number, row: number): number;
  ahx_step_effect(track: number, row: number): number;
  ahx_step_effect_param(track: number, row: number): number;
  ahx_instrument_name(instrument: number): number;
}

const INSPECT_TIMEOUT_MS = 15_000;

let wasmBytesPromise: Promise<ArrayBuffer> | null = null;

function loadWasmBytes(): Promise<ArrayBuffer> {
  wasmBytesPromise ??= fetch(new URL('/vendor/hively-replay.wasm', document.baseURI).href).then(
    (response) => {
      if (!response.ok) throw new Error(`Unable to load the Hively replay core (${response.status}).`);
      return response.arrayBuffer();
    }
  ).catch((error) => {
    wasmBytesPromise = null;
    throw error;
  });
  return wasmBytesPromise;
}

function readCString(memory: WebAssembly.Memory, pointer: number, maximumLength = 128): string {
  if (!pointer) return '';
  const bytes = new Uint8Array(memory.buffer);
  if (pointer < 0 || pointer >= bytes.length) return '';
  let end = pointer;
  const limit = Math.min(pointer + maximumLength, bytes.length);
  while (end < limit && bytes[end] !== 0) end += 1;
  let value = '';
  for (let index = pointer; index < end; index += 1) value += String.fromCharCode(bytes[index]!);
  return value;
}

/**
 * Inspect Hively (AHX/HVL) pattern data without constructing audio output.
 * Runs the replay core in a dedicated worker, mirroring the worklet's
 * pattern-data extraction, so music transport stays owned by libzci.
 */
export async function inspectHivelyPatterns(
  buffer: ArrayBuffer,
  subsong = 0,
  signal?: AbortSignal
): Promise<HivelyInspectionResult> {
  if (signal?.aborted) throw new Error('Hively inspection canceled.');
  const [wasmBytes] = await Promise.all([loadWasmBytes()]);
  if (signal?.aborted) throw new Error('Hively inspection canceled.');

  const worker = new Worker(new URL('./hively-pattern-inspect.worker.ts', import.meta.url), {
    type: 'module'
  });
  try {
    const result = await new Promise<HivelyInspectionResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Hively inspection canceled.'));
        return;
      }
      const timeoutId = window.setTimeout(() => {
        reject(new Error('Hively inspection timed out.'));
      }, INSPECT_TIMEOUT_MS);
      const onAbort = (): void => {
        window.clearTimeout(timeoutId);
        reject(new Error('Hively inspection canceled.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = (event: MessageEvent) => {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        const message = event.data as
          | { data: HivelyPatternData; metadata: HivelyInspectionMetadata }
          | { error: string };
        if ('error' in message) {
          reject(new Error(message.error));
          return;
        }
        try {
          const song = createHivelyPatternSong(message.data);
          resolve({ song, metadata: message.metadata, data: message.data });
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Hively inspection failed.'));
        }
      };
      worker.onerror = () => {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('The Hively inspection worker failed.'));
      };
      worker.onmessageerror = () => {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('The Hively inspection response was unreadable.'));
      };
      try {
        const moduleCopy = buffer.slice(0);
        const wasmCopy = wasmBytes.slice(0);
        worker.postMessage({ buffer: moduleCopy, wasm: wasmCopy, subsong }, [moduleCopy, wasmCopy]);
      } catch (error) {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error('Hively inspection failed.'));
      }
    });
    return result;
  } finally {
    worker.terminate();
  }
}

export function readHivelyCStringForTest(
  memory: WebAssembly.Memory,
  pointer: number
): string {
  return readCString(memory, pointer);
}

export type { HivelyInspectExports };
