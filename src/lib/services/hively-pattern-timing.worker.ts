import { measureHivelyPatternStarts } from './hively-pattern-timing';

interface HivelyTimingExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  ahx_init(): void;
  malloc(bytes: number): number;
  free(pointer: number): void;
  ahx_load(pointer: number, bytes: number, sampleRate: number, stereo: number): number;
  ahx_unload(): void;
  ahx_select_subsong(subsong: number): number;
  ahx_duration_frames(): number;
  ahx_decode_frame(): number;
  ahx_current_order(): number;
  ahx_set_interpolation(filter: number): void;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async (event: MessageEvent<{ wasm: ArrayBuffer; buffer: ArrayBuffer; subsong: number }>) => {
  let core: HivelyTimingExports | undefined;
  try {
    const { wasm, buffer, subsong } = event.data;
    const result = await WebAssembly.instantiate(wasm, {
      env: { emscripten_notify_memory_growth() {} },
      wasi_snapshot_preview1: { fd_write() { return 0; } }
    });
    core = result.instance.exports as HivelyTimingExports;
    core._initialize();
    core.ahx_init();
    const input = core.malloc(buffer.byteLength);
    if (!input) throw new Error('Hively pattern timing allocation failed.');
    try {
      new Uint8Array(core.memory.buffer, input, buffer.byteLength).set(new Uint8Array(buffer));
      if (!core.ahx_load(input, buffer.byteLength, 8000, 2)) throw new Error('Hively pattern timing decode failed.');
    } finally { core.free(input); }
    if (subsong > 0 && !core.ahx_select_subsong(subsong)) throw new Error('Hively pattern timing subsong failed.');
    core.ahx_set_interpolation(1);
    worker.postMessage({ starts: measureHivelyPatternStarts(core) });
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : 'Hively pattern timing failed.' });
  } finally { core?.ahx_unload(); }
};
