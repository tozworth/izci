export class FakeParam {
  value: number;
  ramps: number[] = [];
  rampTimes: number[] = [];
  constructor(value = 0) { this.value = value; }
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void { this.value = value; }
  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.ramps.push(value);
    this.rampTimes.push(time);
  }
}

export class FakeNode {
  connections: Array<{ destination: FakeNode; output?: number; input?: number }> = [];
  disconnectCalls = 0;
  connect(destination: FakeNode, output?: number, input?: number): FakeNode {
    this.connections.push({ destination, output, input });
    return destination;
  }
  disconnect(): void { this.disconnectCalls += 1; }
}

export class FakeGain extends FakeNode { gain = new FakeParam(1); }
export class FakeFilter extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
  gain = new FakeParam();
  getFrequencyResponse(_frequencies: Float32Array, magnitudes: Float32Array, phases?: Float32Array): void {
    magnitudes.fill(10 ** (this.gain.value / 20));
    phases?.fill(0);
  }
}
class FakeDelay extends FakeNode { delayTime = new FakeParam(); }
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam();
  attack = new FakeParam(); release = new FakeParam();
}
class FakeWaveShaper extends FakeNode { curve: Float32Array | null = null; oversample: OverSampleType = 'none'; }
class FakeConvolver extends FakeNode { buffer: AudioBuffer | null = null; normalize = true; }
export class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  sampleValue = 0;
  getFloatTimeDomainData(samples: Float32Array): void { samples.fill(this.sampleValue); }
}

export class FakeAudioBuffer {
  readonly channels: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array { return this.channels[channel]; }
}

export class FakeContext {
  currentTime = 1;
  sampleRate = 48_000;
  gains: FakeGain[] = []; filters: FakeFilter[] = []; splitters: FakeNode[] = []; mergers: FakeNode[] = [];
  iirs: FakeNode[] = []; delays: FakeDelay[] = []; compressors: FakeCompressor[] = [];
  waveShapers: FakeWaveShaper[] = []; convolvers: FakeConvolver[] = []; buffers: FakeAudioBuffer[] = [];
  analysers: FakeAnalyser[] = [];
  createGain(): GainNode { const node = new FakeGain(); this.gains.push(node); return node as unknown as GainNode; }
  createBiquadFilter(): BiquadFilterNode { const node = new FakeFilter(); this.filters.push(node); return node as unknown as BiquadFilterNode; }
  createChannelSplitter(): ChannelSplitterNode { const node = new FakeNode(); this.splitters.push(node); return node as unknown as ChannelSplitterNode; }
  createChannelMerger(): ChannelMergerNode { const node = new FakeNode(); this.mergers.push(node); return node as unknown as ChannelMergerNode; }
  createIIRFilter(): IIRFilterNode { const node = new FakeNode(); this.iirs.push(node); return node as unknown as IIRFilterNode; }
  createDelay(): DelayNode { const node = new FakeDelay(); this.delays.push(node); return node as unknown as DelayNode; }
  createDynamicsCompressor(): DynamicsCompressorNode { const node = new FakeCompressor(); this.compressors.push(node); return node as unknown as DynamicsCompressorNode; }
  createWaveShaper(): WaveShaperNode { const node = new FakeWaveShaper(); this.waveShapers.push(node); return node as unknown as WaveShaperNode; }
  createConvolver(): ConvolverNode { const node = new FakeConvolver(); this.convolvers.push(node); return node as unknown as ConvolverNode; }
  createAnalyser(): AnalyserNode {
    const node = new FakeAnalyser();
    this.analysers.push(node);
    return node as unknown as AnalyserNode;
  }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const buffer = new FakeAudioBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer as unknown as AudioBuffer;
  }
}
