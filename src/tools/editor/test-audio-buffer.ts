/** Small Web Audio stand-in for testing sample content and allocation behavior. */
export class TestAudioBuffer {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  readonly duration: number;
  private channels: Float32Array<ArrayBuffer>[];

  constructor(options: AudioBufferOptions) {
    this.sampleRate = options.sampleRate;
    this.numberOfChannels = options.numberOfChannels ?? 1;
    this.length = options.length;
    this.duration = this.length / this.sampleRate;
    this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
  }

  getChannelData(channel: number): Float32Array<ArrayBuffer> { return this.channels[channel]; }
  copyToChannel(data: Float32Array, channel: number, offset = 0): void { this.channels[channel].set(data, offset); }
  copyFromChannel(target: Float32Array, channel: number, offset = 0): void { target.set(this.channels[channel].subarray(offset, offset + target.length)); }
}

export function testAudioBuffer(channels: number[][], sampleRate = 10): AudioBuffer {
  const buffer = new TestAudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate });
  channels.forEach((samples, index) => buffer.copyToChannel(Float32Array.from(samples), index));
  return buffer as unknown as AudioBuffer;
}
