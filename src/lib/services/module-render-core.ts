/**
 * Offline tracker-module rendering shared by the Editor and Multiplayer render
 * workers. The streaming API keeps Multiplayer's peak PCM memory bounded; the
 * Editor adapter collects the same chunks when it needs complete channel data.
 */

import { initializeOpenMpt } from './openmpt/runtime';
import { OpenMptModule } from './openmpt/module';
import { DEFAULT_OPENMPT_SETTINGS } from './openmpt/protocol';

interface HivelyExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  ahx_init(): void;
  ahx_load(data: number, size: number, sampleRate: number, stereo: number): number;
  ahx_unload(): void;
  ahx_select_subsong(subsong: number): number;
  ahx_set_interpolation(filter: number): void;
  ahx_duration_frames(): number;
  ahx_decode_frame(): number;
  ahx_frame_samples(): number;
  ahx_mix_buffer(): number;
  ahx_ended(): number;
}

export interface ModuleRenderRequest {
  type: 'render';
  extension: string;
  module: ArrayBuffer;
  hivelyWasmUrl: string;
  subsong?: number;
  sampleRate: number;
}

interface ModuleRenderProgress {
  renderedFrames: number;
  totalFrames: number;
}

interface ModulePcmChunk {
  startFrame: number;
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
}

const MODULE_CHUNK_FRAMES = 16_384;

function grow(channel: Float32Array<ArrayBuffer>, requiredLength: number): Float32Array<ArrayBuffer> {
  if (channel.length >= requiredLength) return channel;
  const next = new Float32Array(Math.max(requiredLength, Math.ceil(channel.length * 1.5), 65_536));
  next.set(channel);
  return next;
}

function createProgressReporter(
  sampleRate: number,
  totalFrames: number,
  onProgress: (progress: ModuleRenderProgress) => void
): (renderedFrames: number, complete?: boolean) => void {
  const intervalFrames = Math.max(sampleRate, Math.ceil(totalFrames / 100));
  let nextProgressFrame = intervalFrames;
  return (renderedFrames, complete = false) => {
    if (!complete && renderedFrames < nextProgressFrame) return;
    onProgress({
      renderedFrames,
      totalFrames: complete ? renderedFrames : totalFrames
    });
    nextProgressFrame = renderedFrames + intervalFrames;
  };
}

async function streamOpenMpt(
  request: ModuleRenderRequest,
  onChunk: (chunk: ModulePcmChunk) => void | Promise<void>,
  onProgress: (progress: ModuleRenderProgress) => void
): Promise<number> {
  const module = new OpenMptModule(await initializeOpenMpt(), request.module, request.subsong);
  let renderedFrames = 0;
  try {
    module.configure(DEFAULT_OPENMPT_SETTINGS);
    const expectedFrames = Math.max(1, Math.ceil(module.duration * request.sampleRate));
    const reportProgress = createProgressReporter(request.sampleRate, expectedFrames, onProgress);
    while (true) {
      let chunk: ModulePcmChunk | undefined;
      const frames = module.read(request.sampleRate, MODULE_CHUNK_FRAMES, (left, right, length) => {
        if (length) chunk = { startFrame: renderedFrames, left: left.slice(), right: right.slice() };
      });
      if (frames <= 0) break;
      await onChunk(chunk!);
      renderedFrames += frames;
      reportProgress(renderedFrames);
    }
    reportProgress(renderedFrames, true);
    return renderedFrames;
  } finally {
    module.dispose();
  }
}

async function streamHively(
  request: ModuleRenderRequest,
  onChunk: (chunk: ModulePcmChunk) => void | Promise<void>,
  onProgress: (progress: ModuleRenderProgress) => void
): Promise<number> {
  const wasm = await fetch(request.hivelyWasmUrl).then((response) => {
    if (!response.ok) throw new Error(`Unable to load the Hively replay core (${response.status}).`);
    return response.arrayBuffer();
  });
  const imports = {
    env: { emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write() { return 0; } }
  };
  const result = await WebAssembly.instantiate(wasm, imports);
  const core = result.instance.exports as HivelyExports;
  core._initialize();
  core.ahx_init();
  const inputBytes = new Uint8Array(request.module);
  const inputPointer = core.malloc(inputBytes.byteLength);
  new Uint8Array(core.memory.buffer, inputPointer, inputBytes.byteLength).set(inputBytes);
  const loaded = core.ahx_load(inputPointer, inputBytes.byteLength, request.sampleRate, 2);
  core.free(inputPointer);
  if (!loaded) throw new Error('HivelyTracker could not decode this module.');
  if (request.subsong && !core.ahx_select_subsong(request.subsong)) {
    core.ahx_unload();
    throw new Error('HivelyTracker could not select this subsong.');
  }
  core.ahx_set_interpolation(4);

  const durationFrames = core.ahx_duration_frames();
  const expectedFrames = Math.max(1, Math.ceil(durationFrames * request.sampleRate / 50));
  const reportProgress = createProgressReporter(request.sampleRate, expectedFrames, onProgress);
  let leftChunk = new Float32Array(MODULE_CHUNK_FRAMES);
  let rightChunk = new Float32Array(MODULE_CHUNK_FRAMES);
  let chunkFrames = 0;
  let renderedFrames = 0;
  let emittedFrames = 0;

  const flushChunk = async (): Promise<void> => {
    if (chunkFrames === 0) return;
    const left = chunkFrames === leftChunk.length ? leftChunk : leftChunk.slice(0, chunkFrames);
    const right = chunkFrames === rightChunk.length ? rightChunk : rightChunk.slice(0, chunkFrames);
    await onChunk({ startFrame: emittedFrames, left, right });
    emittedFrames += chunkFrames;
    leftChunk = new Float32Array(MODULE_CHUNK_FRAMES);
    rightChunk = new Float32Array(MODULE_CHUNK_FRAMES);
    chunkFrames = 0;
  };

  try {
    while (core.ahx_decode_frame()) {
      const frameSamples = core.ahx_frame_samples();
      const interleaved = new Int16Array(core.memory.buffer, core.ahx_mix_buffer(), frameSamples * 2);
      for (let index = 0; index < frameSamples; index += 1) {
        leftChunk[chunkFrames] = interleaved[index * 2] / 32_768;
        rightChunk[chunkFrames] = interleaved[index * 2 + 1] / 32_768;
        chunkFrames += 1;
        if (chunkFrames === MODULE_CHUNK_FRAMES) await flushChunk();
      }
      renderedFrames += frameSamples;
      reportProgress(renderedFrames);
      if (core.ahx_ended()) break;
    }
    await flushChunk();
  } finally {
    core.ahx_unload();
  }

  reportProgress(renderedFrames, true);
  return renderedFrames;
}

export async function streamModulePcm(
  request: ModuleRenderRequest,
  onChunk: (chunk: ModulePcmChunk) => void | Promise<void>,
  onProgress: (progress: ModuleRenderProgress) => void = () => undefined
): Promise<number> {
  return request.extension === 'ahx' || request.extension === 'hvl'
    ? streamHively(request, onChunk, onProgress)
    : streamOpenMpt(request, onChunk, onProgress);
}

export async function renderModulePcm(
  request: ModuleRenderRequest,
  onProgress: (progress: ModuleRenderProgress) => void = () => undefined
): Promise<[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]> {
  let left = new Float32Array(0);
  let right = new Float32Array(0);
  let renderedFrames = 0;
  await streamModulePcm(request, ({ startFrame, left: leftChunk, right: rightChunk }) => {
    const requiredLength = startFrame + Math.min(leftChunk.length, rightChunk.length);
    left = grow(left, requiredLength);
    right = grow(right, requiredLength);
    left.set(leftChunk, startFrame);
    right.set(rightChunk, startFrame);
    renderedFrames = Math.max(renderedFrames, requiredLength);
  }, onProgress);
  return [left.slice(0, renderedFrames), right.slice(0, renderedFrames)];
}
