import type { ModulePatternSong, TrackMetadata } from '$lib/types';
import type { OpenMptCore } from './abi';
import type { OpenMptInspection, OpenMptProgress, OpenMptSettings } from './protocol';

/** Owns exactly one ext handle. Input is copied by libopenmpt and freed immediately. */
export class OpenMptModule {
  readonly core: OpenMptCore;
  #ext = 0;
  #module = 0;
  #left = 0;
  #right = 0;
  #frames = 0;
  #mute: ((...args: number[]) => number) | undefined;
  #muted: boolean[] = [];
  #settings: Partial<OpenMptSettings> = {};

  constructor(core: OpenMptCore, buffer: ArrayBuffer, subsong = 0) {
    this.core = core;
    if (!buffer.byteLength) throw new Error('libopenmpt failed to decode this module.');
    const input = this.#allocate(buffer.byteLength);
    try {
      core.HEAPU8.set(new Uint8Array(buffer), input);
      this.#ext = core._openmpt_module_ext_create_from_memory(input, buffer.byteLength, 0, 0, 0, 0, 0, 0, 0);
      this.#module = this.#ext ? core._openmpt_module_ext_get_module(this.#ext) : 0;
      if (!this.#module) throw new Error('libopenmpt failed to decode this module.');
      this.selectSubsong(subsong);
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      core._free(input);
    }
  }

  get subsong(): number {
    return this.core._openmpt_module_get_selected_subsong(this.#module);
  }

  get duration(): number {
    const duration = this.core._openmpt_module_get_duration_seconds(this.#module);
    return Number.isFinite(duration) ? Math.max(0, duration) : 0;
  }

  selectSubsong(index: number): void {
    const count = Math.max(1, this.core._openmpt_module_get_num_subsongs(this.#module));
    const selected = Math.min(count - 1, Math.max(0, Number.isFinite(index) ? Math.trunc(index) : 0));
    this.core._openmpt_module_select_subsong(this.#module, selected);
    this.seek(0);
  }

  seek(seconds: number): number {
    const position = this.core._openmpt_module_set_position_seconds(
      this.#module, Math.min(this.duration, Math.max(0, Number.isFinite(seconds) ? seconds : 0))
    );
    this.#applyMutes();
    return position;
  }

  configure(settings: OpenMptSettings): void {
    const core = this.core;
    const previous = this.#settings;
    if (previous.repeatCount !== settings.repeatCount) core._openmpt_module_set_repeat_count(this.#module, settings.repeatCount);
    if (previous.stereoSeparation !== settings.stereoSeparation) core._openmpt_module_set_render_param(this.#module, 2, settings.stereoSeparation);
    if (previous.interpolationFilter !== settings.interpolationFilter) core._openmpt_module_set_render_param(this.#module, 3, settings.interpolationFilter);
    if (previous.rampingStrength !== settings.rampingStrength) core._openmpt_module_set_render_param(this.#module, 4, settings.rampingStrength);
    for (const [field, key] of [['tempoFactor', 'play.tempo_factor'], ['pitchFactor', 'play.pitch_factor']] as const) {
      if (previous[field] !== settings[field]) {
        this.#withString(key, (pointer) => core._openmpt_module_ctl_set_floatingpoint(this.#module, pointer, settings[field]));
      }
    }
    this.#settings = { ...settings };
  }

  setChannelMutes(muted: boolean[]): void {
    this.#muted = muted.map((value) => value === true);
    if (!this.#mute) {
      // libopenmpt_ext.h: wasm32 interactive is 16 pointers, mute setter is entry 10.
      const stack = this.core.stackSave();
      try {
        const target = this.core.stackAlloc(16 * 4);
        const accepted = this.#withString('interactive', (name) =>
          this.core._openmpt_module_ext_get_interface(this.#ext, name, target, 16 * 4));
        if (!accepted) throw new Error('libopenmpt channel controls are unavailable.');
        this.#mute = this.core.getWasmTableEntry(this.core.HEAPU32[target / 4 + 10]);
      } finally {
        this.core.stackRestore(stack);
      }
    }
    this.#applyMutes();
  }

  #applyMutes(): void {
    if (!this.#mute) return;
    const count = this.core._openmpt_module_get_num_channels(this.#module);
    for (let channel = 0; channel < count; channel++) this.#mute(this.#ext, channel, this.#muted[channel] ? 1 : 0);
  }

  inspect(patterns = false): OpenMptInspection {
    const core = this.core;
    const get = (key: string) => this.#withString(key, (pointer) => this.#takeString(core._openmpt_module_get_metadata(this.#module, pointer))) || undefined;
    const patternCount = core._openmpt_module_get_num_patterns(this.#module);
    const subsongs = core._openmpt_module_get_num_subsongs(this.#module);
    const metadata: TrackMetadata = {
      title: get('title'), artist: get('artist'), message: get('message') || get('message_raw'),
      trackerType: get('tracker') || get('originaltype_long') || get('type'), originalType: get('originaltype'),
      duration: this.duration,
      patterns: patternCount, channels: core._openmpt_module_get_num_channels(this.#module),
      instruments: core._openmpt_module_get_num_instruments(this.#module), orders: core._openmpt_module_get_num_orders(this.#module),
      subsongs: Math.max(1, subsongs),
      subsongNames: Array.from({ length: subsongs }, (_, index) => this.#takeString(core._openmpt_module_get_subsong_name(this.#module, index))),
      rows: Array.from({ length: patternCount }, (_, index) => core._openmpt_module_get_pattern_num_rows(this.#module, index)).reduce((total, rows) => total + rows, 0)
    };
    return { metadata, subsong: this.subsong, ...(patterns ? { song: this.#patterns() } : {}) };
  }

  #patterns(): ModulePatternSong {
    const core = this.core;
    const channels = core._openmpt_module_get_num_channels(this.#module);
    const names = (count: number, get: (module: number, index: number) => number) =>
      Array.from({ length: count }, (_, index) => this.#takeString(get(this.#module, index)));
    return {
      channels: names(channels, core._openmpt_module_get_channel_name),
      instruments: names(core._openmpt_module_get_num_instruments(this.#module), core._openmpt_module_get_instrument_name),
      samples: names(core._openmpt_module_get_num_samples(this.#module), core._openmpt_module_get_sample_name),
      numSubsongs: core._openmpt_module_get_num_subsongs(this.#module),
      patternStartTimes: Array.from({ length: core._openmpt_module_get_num_orders(this.#module) }, (_, order) =>
        core._openmpt_module_get_time_at_position(this.#module, order, 0))
        .filter((time) => Number.isFinite(time) && time >= 0 && time < this.duration)
        .sort((a, b) => a - b)
        .filter((time, index, times) => index === 0 || time !== times[index - 1]),
      orders: Array.from({ length: core._openmpt_module_get_num_orders(this.#module) }, (_, index) => ({
        name: this.#takeString(core._openmpt_module_get_order_name(this.#module, index)),
        pat: core._openmpt_module_get_order_pattern(this.#module, index)
      })),
      patterns: Array.from({ length: core._openmpt_module_get_num_patterns(this.#module) }, (_, pattern) => ({
        name: this.#takeString(core._openmpt_module_get_pattern_name(this.#module, pattern)),
        rows: Array.from({ length: core._openmpt_module_get_pattern_num_rows(this.#module, pattern) }, (_, row) =>
          Array.from({ length: channels }, (_, channel) => this.#takeString(
            core._openmpt_module_format_pattern_row_channel(this.#module, pattern, row, channel, 14, 1))))
      }))
    };
  }

  reserveFrames(frames: number): void {
    if (frames > this.#frames) {
      const left = this.#allocate(frames * 4);
      let right: number;
      try { right = this.#allocate(frames * 4); }
      catch (error) { this.core._free(left); throw error; }
      if (this.#left) this.core._free(this.#left);
      if (this.#right) this.core._free(this.#right);
      this.#left = left;
      this.#right = right;
      this.#frames = frames;
    }
  }

  read(sampleRate: number, frames: number, consume: (left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>, frames: number) => void): number {
    this.reserveFrames(frames);
    const read = this.core._openmpt_module_read_float_stereo(this.#module, sampleRate, frames, this.#left, this.#right);
    // Read heap views after decoding, since WASM can grow its memory.
    consume(this.core.HEAPF32.subarray(this.#left / 4, this.#left / 4 + read), this.core.HEAPF32.subarray(this.#right / 4, this.#right / 4 + read), read);
    return read;
  }

  progress(): OpenMptProgress {
    return {
      currentTime: this.core._openmpt_module_get_position_seconds(this.#module),
      order: this.core._openmpt_module_get_current_order(this.#module),
      pattern: this.core._openmpt_module_get_current_pattern(this.#module),
      row: this.core._openmpt_module_get_current_row(this.#module), subsong: this.subsong
    };
  }

  dispose(): void {
    if (this.#ext) this.core._openmpt_module_ext_destroy(this.#ext);
    if (this.#left) this.core._free(this.#left);
    if (this.#right) this.core._free(this.#right);
    this.#ext = this.#module = this.#left = this.#right = this.#frames = 0;
    this.#mute = undefined;
    this.#muted = [];
  }

  #allocate(bytes: number): number {
    const pointer = this.core._malloc(bytes);
    if (!pointer) throw new Error('libopenmpt ran out of memory.');
    return pointer;
  }

  #takeString(pointer: number): string {
    if (!pointer) return '';
    try { return this.core.UTF8ToString(pointer); }
    finally { this.core._openmpt_free_string(pointer); }
  }

  #withString<T>(text: string, use: (pointer: number) => T): T {
    const stack = this.core.stackSave();
    try {
      const pointer = this.core.stackAlloc(text.length + 1);
      for (let index = 0; index < text.length; index++) this.core.HEAPU8[pointer + index] = text.charCodeAt(index);
      this.core.HEAPU8[pointer + text.length] = 0;
      return use(pointer);
    } finally {
      this.core.stackRestore(stack);
    }
  }
}
