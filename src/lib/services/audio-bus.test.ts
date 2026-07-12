import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AudioBusService } from './audio-bus';

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
  }
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

  readonly destination = new FakeAudioNode(this);
  readonly gains: FakeAudioNode[] = [];
  readonly analysers: FakeAnalyserNode[] = [];
  readonly mediaSources: FakeMediaElementSourceNode[] = [];
  state: AudioContextState = 'suspended';
  closeCalls = 0;
  resumeCalls = 0;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain(): GainNode {
    const node = new FakeAudioNode(this);
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
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    bus = new AudioBusService();
  });

  afterEach(() => {
    bus.destroy();
    vi.unstubAllGlobals();
  });

  it('creates one pass-through graph ending at the browser destination', () => {
    const context = bus.context as unknown as FakeAudioContext;
    const [input, output] = context.gains;
    const [analyser] = context.analysers;

    expect(input.connections).toEqual([output]);
    expect(output.connections).toEqual([analyser]);
    expect(analyser.connections).toEqual([context.destination]);
  });

  it('switches module sources without rebuilding the shared graph', () => {
    const context = bus.context as unknown as FakeAudioContext;
    const first = new FakeAudioNode(context);
    const second = new FakeAudioNode(context);

    bus.connectAudioNode(first as unknown as AudioNode);
    bus.connectAudioNode(second as unknown as AudioNode);

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(first.disconnections).toEqual([context.gains[0]]);
    expect(second.connections).toEqual([context.gains[0]]);
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

  it('resumes the shared context for either playback backend', async () => {
    const context = bus.context as unknown as FakeAudioContext;

    bus.resume();
    await Promise.resolve();

    expect(context.resumeCalls).toBe(1);
    expect(context.state).toBe('running');
  });
});
