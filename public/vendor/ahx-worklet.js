const FRAMES_PER_SECOND = 50;
const PROGRESS_INTERVAL_SAMPLES = 0.125;

class AhxReplayProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.exports = null;
    this.playing = false;
    this.repeat = false;
    this.subsong = 0;
    this.format = 'ahx';
    this.frameOffset = 0;
    this.frameSamples = 0;
    this.frameIsLast = false;
    this.endedPublished = false;
    this.playedSamples = 0;
    this.lastProgressSamples = 0;
    this.lastPatternOrder = -1;
    this.lastPatternRow = -1;
    this.port.onmessage = (event) => void this.handleMessage(event.data);
  }

  async handleMessage(message) {
    try {
      switch (message?.type) {
        case 'load':
          await this.load(message);
          break;
        case 'play':
          this.playing = true;
          break;
        case 'pause':
          this.playing = false;
          this.publishProgress(true);
          break;
        case 'seek':
          this.seek(message.seconds);
          break;
        case 'subsong':
          this.selectSubsong(message.subsong);
          break;
        case 'repeat':
          this.repeat = message.enabled === true;
          break;
        case 'interpolation':
          this.exports?.ahx_set_interpolation(message.filter);
          break;
        case 'dispose':
          this.exports?.ahx_unload();
          this.exports = null;
          this.playing = false;
          break;
      }
    } catch (error) {
      this.port.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Hively playback failed.'
      });
    }
  }

  async load(message) {
    this.exports?.ahx_unload();
    const imports = {
      env: { emscripten_notify_memory_growth() {} },
      wasi_snapshot_preview1: { fd_write() { return 0; } }
    };
    const result = await WebAssembly.instantiate(message.wasm, imports);
    const exports = result.instance.exports;
    exports._initialize();
    exports.ahx_init();

    const bytes = new Uint8Array(message.module);
    const input = exports.malloc(bytes.byteLength);
    new Uint8Array(exports.memory.buffer, input, bytes.byteLength).set(bytes);
    const loaded = exports.ahx_load(input, bytes.byteLength, sampleRate, message.stereo ?? 2);
    exports.free(input);
    if (!loaded) throw new Error('HivelyTracker failed to decode this module.');
    exports.ahx_set_interpolation(message.interpolationFilter);

    this.exports = exports;
    this.repeat = message.repeat === true;
    this.format = message.format === 'hvl' ? 'hvl' : 'ahx';
    this.subsong = Math.max(0, Math.trunc(message.subsong ?? 0));
    if (this.subsong > 0 && !exports.ahx_select_subsong(this.subsong)) this.subsong = 0;
    this.resetBufferedFrame();
    this.playing = false;
    this.publishMetadata();
    this.publishPatternData();
    this.publishPatternProgress(true);
    this.publishProgress(true);
    this.port.postMessage({ type: 'loaded' });
  }

  readString(pointer, maximumLength = 128) {
    if (!pointer || !this.exports) return '';
    const memory = new Uint8Array(this.exports.memory.buffer);
    let end = pointer;
    const limit = Math.min(pointer + maximumLength, memory.length);
    while (end < limit && memory[end] !== 0) end++;
    let value = '';
    for (let index = pointer; index < end; index++) value += String.fromCharCode(memory[index]);
    return value;
  }

  publishMetadata() {
    const core = this.exports;
    if (!core) return;
    this.port.postMessage({
      type: 'metadata',
      metadata: {
        title: this.readString(core.ahx_title()) || undefined,
        trackerType: this.format === 'hvl' ? 'HivelyTracker' : 'Abyss\' Highest eXperience',
        originalType: this.format,
        duration: core.ahx_duration_frames() / FRAMES_PER_SECOND,
        channels: core.ahx_channel_count(),
        instruments: core.ahx_instrument_count(),
        orders: core.ahx_order_count(),
        subsongs: core.ahx_subsong_count()
      }
    });
  }

  publishPatternData() {
    const core = this.exports;
    if (!core) return;
    const channelCount = core.ahx_channel_count();
    const positionCount = core.ahx_order_count();
    const trackCount = core.ahx_track_count();
    const trackLength = core.ahx_track_length();
    const instrumentCount = core.ahx_instrument_count();
    const positionTracks = new Uint8Array(positionCount * channelCount);
    const positionTransposes = new Int8Array(positionCount * channelCount);
    const steps = new Uint8Array(trackCount * trackLength * 4);
    const instrumentNames = [];

    for (let position = 0; position < positionCount; position++) {
      for (let channel = 0; channel < channelCount; channel++) {
        const index = position * channelCount + channel;
        positionTracks[index] = core.ahx_position_track(position, channel);
        positionTransposes[index] = core.ahx_position_transpose(position, channel);
      }
    }

    for (let track = 0; track < trackCount; track++) {
      for (let row = 0; row < trackLength; row++) {
        const index = (track * trackLength + row) * 4;
        steps[index] = core.ahx_step_note(track, row);
        steps[index + 1] = core.ahx_step_instrument(track, row);
        steps[index + 2] = core.ahx_step_effect(track, row);
        steps[index + 3] = core.ahx_step_effect_param(track, row);
      }
    }

    for (let instrument = 1; instrument <= instrumentCount; instrument++) {
      instrumentNames.push(this.readString(core.ahx_instrument_name(instrument)));
    }

    this.port.postMessage({
      type: 'pattern-data',
      data: {
        channelCount,
        instrumentNames,
        positionCount,
        positionTracks,
        positionTransposes,
        steps,
        subsongCount: core.ahx_subsong_count(),
        trackCount,
        trackLength
      }
    }, [positionTracks.buffer, positionTransposes.buffer, steps.buffer]);
  }

  publishPatternProgress(force = false) {
    const core = this.exports;
    if (!core) return;
    const order = core.ahx_current_order();
    const row = core.ahx_current_row();
    if (!force && order === this.lastPatternOrder && row === this.lastPatternRow) return;
    this.lastPatternOrder = order;
    this.lastPatternRow = row;
    this.port.postMessage({ type: 'pattern-progress', order, row });
  }

  resetBufferedFrame() {
    this.frameOffset = 0;
    this.frameSamples = 0;
    this.frameIsLast = false;
    this.endedPublished = false;
    this.playedSamples = (this.exports?.ahx_current_frame() ?? 0) * (sampleRate / FRAMES_PER_SECOND);
    this.lastProgressSamples = this.playedSamples;
    this.lastPatternOrder = -1;
    this.lastPatternRow = -1;
  }

  seek(seconds) {
    if (!this.exports) return;
    const duration = this.exports.ahx_duration_frames() / FRAMES_PER_SECOND;
    const target = Math.min(Math.max(Number(seconds) || 0, 0), duration || Number.MAX_SAFE_INTEGER);
    this.exports.ahx_seek_frame(Math.floor(target * FRAMES_PER_SECOND));
    this.resetBufferedFrame();
    this.publishPatternProgress(true);
    this.publishProgress(true);
  }

  selectSubsong(subsong) {
    if (!this.exports) return;
    const normalized = Math.max(0, Math.trunc(subsong ?? 0));
    if (!this.exports.ahx_select_subsong(normalized)) return;
    this.subsong = normalized;
    this.resetBufferedFrame();
    this.publishMetadata();
    this.publishPatternProgress(true);
    this.publishProgress(true);
  }

  publishProgress(force = false) {
    if (!this.exports) return;
    const interval = sampleRate * PROGRESS_INTERVAL_SAMPLES;
    if (!force && this.playedSamples - this.lastProgressSamples < interval) return;
    this.lastProgressSamples = this.playedSamples;
    this.port.postMessage({
      type: 'progress',
      currentTime: this.playedSamples / sampleRate,
      duration: this.exports.ahx_duration_frames() / FRAMES_PER_SECOND,
      subsong: this.subsong,
      subsongCount: this.exports.ahx_subsong_count()
    });
  }

  decodeNextFrame() {
    const core = this.exports;
    if (!core) return false;

    if (!core.ahx_decode_frame()) {
      if (!this.repeat || !core.ahx_select_subsong(this.subsong) || !core.ahx_decode_frame()) {
        return false;
      }
      this.playedSamples = 0;
      this.lastProgressSamples = 0;
    }

    this.frameSamples = core.ahx_frame_samples();
    this.frameOffset = 0;
    this.frameIsLast = core.ahx_ended() !== 0 && !this.repeat;
    this.publishPatternProgress();
    return this.frameSamples > 0;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] ?? left;
    if (!left || !right || !this.playing || !this.exports) return true;

    let outputOffset = 0;
    while (outputOffset < left.length) {
      if (this.frameOffset >= this.frameSamples && !this.decodeNextFrame()) {
        this.playing = false;
        if (!this.endedPublished) {
          this.endedPublished = true;
          this.publishProgress(true);
          this.port.postMessage({ type: 'ended' });
        }
        break;
      }

      const available = Math.min(left.length - outputOffset, this.frameSamples - this.frameOffset);
      const samples = new Int16Array(
        this.exports.memory.buffer,
        this.exports.ahx_mix_buffer(),
        this.frameSamples * 2
      );
      for (let index = 0; index < available; index++) {
        const source = (this.frameOffset + index) * 2;
        left[outputOffset + index] = samples[source] / 32768;
        right[outputOffset + index] = samples[source + 1] / 32768;
      }

      this.frameOffset += available;
      outputOffset += available;
      this.playedSamples += available;

      if (this.frameOffset >= this.frameSamples && this.frameIsLast) {
        this.frameSamples = 0;
      }
    }

    this.publishProgress();
    return true;
  }
}

registerProcessor('izci-ahx-replay', AhxReplayProcessor);
