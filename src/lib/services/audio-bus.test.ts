import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AudioBusService } from './audio-bus';
import { visualizerSettings } from '$lib/stores/visualizer-settings';
const capabilities = vi.hoisted(() => ({ mediaElementWebAudio: true }));
vi.mock('$platform', () => ({ platformCapabilities: capabilities }));

class FakeAudioNode {
  readonly connections: FakeAudioNode[] = [];
  readonly disconnections: Array<FakeAudioNode | undefined> = [];

  constructor(readonly context: FakeAudioContext) {}

  connect(destination: FakeAudioNode): FakeAudioNode {
    this.connections.push(destination);
    return destination;
  }

  disconnect(destination?: FakeAudioNode): void {
    this.disconnections.push(destination);
    if (destination) {
      const index = this.connections.indexOf(destination);
      if (index !== -1) this.connections.splice(index, 1);
    } else {
      this.connections.length = 0;
    }
  }
}

class FakeAudioParam {
  value = 1;
  readonly setCalls: Array<{ value: number; time: number }> = [];
  readonly rampCalls: Array<{ value: number; time: number }> = [];
  readonly curveCalls: Array<{ values: number[]; time: number; duration: number }> = [];
  cancelScheduledValues(): void {}
  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.setCalls.push({ value, time });
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.rampCalls.push({ value, time });
  }
  setValueCurveAtTime(values: Float32Array, time: number, duration: number): void {
    this.value = values.at(-1) ?? this.value;
    this.curveCalls.push({ values: Array.from(values), time, duration });
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 0;
  minDecibels = 0;
  maxDecibels = 0;
  smoothingTimeConstant = 0;
}

class FakeMediaElementSourceNode extends FakeAudioNode {
  constructor(context: FakeAudioContext, readonly mediaElement: HTMLMediaElement) {
    super(context);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static constructorOptions: AudioContextOptions[] = [];

  readonly destination = new FakeAudioNode(this);
  readonly gains: FakeGainNode[] = [];
  readonly analysers: FakeAnalyserNode[] = [];
  readonly mediaSources: FakeMediaElementSourceNode[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  closeCalls = 0;
  resumeCalls = 0;

  constructor(options: AudioContextOptions = {}) {
    FakeAudioContext.instances.push(this);
    FakeAudioContext.constructorOptions.push(options);
  }

  createGain(): GainNode {
    const node = new FakeGainNode(this);
    this.gains.push(node);
    return node as unknown as GainNode;
  }

  createAnalyser(): AnalyserNode {
    const node = new FakeAnalyserNode(this);
    this.analysers.push(node);
    return node as unknown as AnalyserNode;
  }

  createMediaElementSource(element: HTMLMediaElement): MediaElementAudioSourceNode {
    const node = new FakeMediaElementSourceNode(this, element);
    this.mediaSources.push(node);
    return node as unknown as MediaElementAudioSourceNode;
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
  }
}

describe('AudioBusService', () => {
  let bus: AudioBusService;

  beforeEach(() => {
    FakeAudioContext.instances = [];
    FakeAudioContext.constructorOptions = [];
    vi.stubGlobal('window', {
      AudioContext: FakeAudioContext,
      localStorage: { setItem: vi.fn() },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    bus = new AudioBusService();
  });

  afterEach(() => {
    bus.destroy();
    vi.unstubAllGlobals();
    visualizerSettings.reset();
  });

  it('taps pre-Raf by default without routing the analyser into audible output', () => {
    const context = bus.context as unknown as FakeAudioContext;
    const [input, output, program] = context.gains;
    const [analyser] = context.analysers;

    const rafInput = context.gains[3];
    const rafOutput = context.gains[4];
    expect(input.connections).toEqual([rafInput, analyser]);
    expect(rafOutput.connections).toEqual([output]);
    expect(analyser.connections).toEqual([]);
    expect(output.connections).toEqual([context.destination]);
    expect(program.connections).toEqual([]);
    expect(FakeAudioContext.constructorOptions).toEqual([{ latencyHint: 'playback' }]);
  });

  it('switches the live tap in both directions without touching playback connections', () => {
    const context = bus.context as unknown as FakeAudioContext;
    const [input, output, , rafInput, rafOutput] = context.gains;
    const [analyser] = context.analysers;

    visualizerSettings.update({ postRaf: true });
    expect(input.connections).toEqual([rafInput]);
    expect(input.disconnections).toEqual([analyser]);
    expect(rafOutput.connections).toEqual([output, analyser]);

    visualizerSettings.update({ height: 0.5 });
    expect(rafOutput.connections).toEqual([output, analyser]);
    expect(rafOutput.disconnections).toEqual([]);

    visualizerSettings.update({ postRaf: false });
    expect(input.connections).toEqual([rafInput, analyser]);
    expect(rafOutput.connections).toEqual([output]);
    expect(rafOutput.disconnections).toEqual([analyser]);
    expect(analyser.connections).toEqual([]);
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it('uses the saved tap when creating and recreating the graph', () => {
    visualizerSettings.update({ postRaf: true });
    const first = bus.context as unknown as FakeAudioContext;
    expect(first.gains[0].connections).not.toContain(first.analysers[0]);
    expect(first.gains[4].connections).toContain(first.analysers[0]);

    bus.destroy();
    visualizerSettings.update({ postRaf: false });
    expect(first.gains[0].connections).toEqual([]);
    expect(first.gains[4].connections).toEqual([]);
    const second = bus.context as unknown as FakeAudioContext;
    expect(second.gains[0].connections).toContain(second.analysers[0]);
    expect(second.gains[4].connections).toEqual([second.gains[1]]);
  });

  it('keeps the shared input at unity and applies player volume after the analyser', () => {
    bus.setOutputGain(0.25);

    const context = bus.context as unknown as FakeAudioContext;
    const [input, output] = context.gains;

    expect(input.gain.value).toBe(1);
    expect(output.gain.value).toBe(0.25);
  });

  it('mixes two sources through independent gains without rebuilding the shared graph', () => {
    const context = bus.context as unknown as FakeAudioContext;
    const first = new FakeAudioNode(context);
    const second = new FakeAudioNode(context);

    bus.connectAudioNode(first as unknown as AudioNode);
    bus.connectAudioNode(second as unknown as AudioNode);

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(first.disconnections).toEqual([]);
    expect(first.connections).toHaveLength(1);
    expect(second.connections).toHaveLength(1);
    expect(first.connections[0]).not.toBe(second.connections[0]);
    const firstTransition = first.connections[0] as FakeGainNode;
    const secondTransition = second.connections[0] as FakeGainNode;
    expect(firstTransition.connections[0].connections).toEqual([context.gains[0]]);
    expect(secondTransition.connections[0].connections).toEqual([context.gains[0]]);
    expect(firstTransition.connections).toContain(context.gains[2]);
    expect(secondTransition.connections).toContain(context.gains[2]);

    bus.setSourceGain(first as unknown as AudioNode, 0, 2);
    const curve = firstTransition.gain.curveCalls.at(-1);
    expect(curve?.duration).toBe(2);
    expect(curve?.values[0]).toBe(1);
    expect(curve?.values.at(-1)).toBe(0);
    expect(curve?.values[Math.floor((curve?.values.length ?? 0) / 2)]).toBeLessThan(0.5);
  });

  it('reuses the media source tied to a Howler media element', () => {
    const element = {} as HTMLMediaElement;
    const first = bus.connectHtmlMediaElement(element);

    bus.disconnect(first);
    const second = bus.connectHtmlMediaElement(element);
    const context = bus.context as unknown as FakeAudioContext;

    expect(second).toBe(first);
    expect(context.mediaSources).toHaveLength(1);
  });

  it('leaves media elements on native output when Web Audio is unavailable', () => {
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });

    expect(bus.connectHtmlMediaElement({} as HTMLMediaElement)).toBeNull();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('uses native media output on a WebView that cannot route media while preserving module routing', () => {
    capabilities.mediaElementWebAudio = false;
    try {
      expect(bus.connectHtmlMediaElement({} as HTMLMediaElement)).toBeNull();
      expect(FakeAudioContext.instances).toHaveLength(0);
      const context = bus.context as unknown as FakeAudioContext;
      const source = new FakeAudioNode(context);
      expect(bus.connectAudioNode(source as unknown as AudioNode)).toBe(source);
      expect(source.connections).toHaveLength(1);
    } finally { capabilities.mediaElementWebAudio = true; }
  });

  it('resumes the shared context for either playback backend', async () => {
    const context = bus.context as unknown as FakeAudioContext;

    bus.resume();
    await Promise.resolve();

    expect(context.resumeCalls).toBe(1);
    expect(context.state).toBe('running');
  });

  it('creates and resumes the graph when playback starts before a source is connected', async () => {
    await bus.resume();

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].resumeCalls).toBe(1);
    expect(FakeAudioContext.instances[0].state).toBe('running');
  });

  it('routes a rendered media element to both the raw program and local processing branches', () => {
    const element = {} as HTMLMediaElement;
    const source = bus.connectHtmlMediaElement(element) as unknown as FakeMediaElementSourceNode;
    const context = bus.context as unknown as FakeAudioContext;
    const [input, , program] = context.gains;
    const transition = source.connections[0] as FakeGainNode;
    const localGain = transition.connections[0] as FakeGainNode;

    expect(transition.connections).toEqual([localGain, program]);
    expect(localGain.connections).toEqual([input]);
    expect(input.connections).toHaveLength(2);
    expect(input.connections[0]).not.toBe(context.analysers[0]);
    expect(input.connections[1]).toBe(context.analysers[0]);
  });
});
