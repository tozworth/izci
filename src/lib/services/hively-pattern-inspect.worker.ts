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

function readString(memory: WebAssembly.Memory, pointer: number, maximumLength = 128): string {
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

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async (
  event: MessageEvent<{ wasm: ArrayBuffer; buffer: ArrayBuffer; subsong: number }>
) => {
  let core: HivelyInspectExports | undefined;
  try {
    const { wasm, buffer, subsong } = event.data;
    if (!wasm?.byteLength || !buffer?.byteLength) throw new Error('Hively inspection needs module bytes.');
    const result = await WebAssembly.instantiate(wasm, {
      env: { emscripten_notify_memory_growth() {} },
      wasi_snapshot_preview1: { fd_write() { return 0; } }
    });
    core = result.instance.exports as HivelyInspectExports;
    core._initialize();
    core.ahx_init();
    const input = core.malloc(buffer.byteLength);
    if (!input) throw new Error('Hively inspection allocation failed.');
    try {
      new Uint8Array(core.memory.buffer, input, buffer.byteLength).set(new Uint8Array(buffer));
      if (!core.ahx_load(input, buffer.byteLength, 48_000, 2)) {
        throw new Error('HivelyTracker failed to decode this module.');
      }
    } finally {
      core.free(input);
    }
    const normalizedSubsong = Math.max(0, Math.trunc(subsong ?? 0));
    if (normalizedSubsong > 0 && !core.ahx_select_subsong(normalizedSubsong)) {
      throw new Error('Hively inspection subsong failed.');
    }

    const channelCount = core.ahx_channel_count();
    const positionCount = core.ahx_order_count();
    const trackCount = core.ahx_track_count();
    const trackLength = core.ahx_track_length();
    const instrumentCount = core.ahx_instrument_count();
    const subsongCount = Math.max(1, core.ahx_subsong_count());
    if (!channelCount || !positionCount || !trackCount || !trackLength) {
      throw new Error('Hively inspection found no pattern data.');
    }
    if (channelCount > 32 || positionCount > 1024 || trackCount > 1024 || trackLength > 256) {
      throw new Error('Hively inspection pattern exceeds bounded limits.');
    }

    const positionTracks = new Uint8Array(positionCount * channelCount);
    const positionTransposes = new Int8Array(positionCount * channelCount);
    for (let position = 0; position < positionCount; position += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const index = position * channelCount + channel;
        positionTracks[index] = Math.max(0, core.ahx_position_track(position, channel));
        positionTransposes[index] = core.ahx_position_transpose(position, channel);
      }
    }

    const steps = new Uint8Array(trackCount * trackLength * 4);
    for (let track = 0; track < trackCount; track += 1) {
      for (let row = 0; row < trackLength; row += 1) {
        const index = (track * trackLength + row) * 4;
        steps[index] = core.ahx_step_note(track, row);
        steps[index + 1] = core.ahx_step_instrument(track, row);
        steps[index + 2] = core.ahx_step_effect(track, row);
        steps[index + 3] = core.ahx_step_effect_param(track, row);
      }
    }

    const instrumentNames: string[] = [];
    for (let instrument = 1; instrument <= instrumentCount; instrument += 1) {
      instrumentNames.push(readString(core.memory, core.ahx_instrument_name(instrument)));
    }

    const title = readString(core.memory, core.ahx_title());
    const duration = core.ahx_duration_frames() / 50;
    worker.postMessage(
      {
        data: {
          channelCount,
          instrumentNames,
          positionCount,
          positionTracks,
          positionTransposes,
          steps,
          subsongCount,
          trackCount,
          trackLength
        },
        metadata: {
          title,
          channels: channelCount,
          subsongs: subsongCount,
          instruments: instrumentCount,
          orders: positionCount,
          duration: Number.isFinite(duration) && duration > 0 ? duration : 0
        }
      },
      [positionTracks.buffer, positionTransposes.buffer, steps.buffer]
    );
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : 'Hively inspection failed.' });
  } finally {
    try {
      core?.ahx_unload();
    } catch {
      // Best effort; the worker terminates after the response.
    }
  }
};
