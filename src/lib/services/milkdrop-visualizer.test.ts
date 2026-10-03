import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visualizerService } from './visualizer';
import { visualizerSettings } from '$lib/stores/visualizer-settings';
import { createMilkDropVisualizer, getMilkDropRenderSize } from './milkdrop-visualizer';

const mock = vi.hoisted(() => ({
  create: vi.fn(), loadPreset: vi.fn(), render: vi.fn(), resize: vi.fn(),
  catalog: vi.fn(), loseContext: vi.fn()
}));
vi.mock('butterchurn', () => ({ default: { createVisualizer: mock.create } }));
vi.mock('./milkdrop-presets', async (original) => ({
  ...await original<typeof import('./milkdrop-presets')>(), loadMilkDropPresets: mock.catalog
}));
vi.mock('./logging', () => ({ logWarning: vi.fn() }));

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let canvas: HTMLCanvasElement;
let listeners: Map<string, EventListener>;
let controller: ReturnType<typeof createMilkDropVisualizer> | null = null;
let hidden = false;
let inert = false;

async function flushImports() {
  await vi.waitFor(() => expect(mock.create).toHaveBeenCalled());
  await Promise.resolve();
}

function renderFrame(timestamp: number) {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(timestamp));
}

beforeEach(() => {
  vi.resetAllMocks();
  hidden = false;
  inert = false;
  frames = new Map();
  nextFrame = 1;
  listeners = new Map();
  mock.create.mockReturnValue({ loadPreset: mock.loadPreset, render: mock.render, setRendererSize: mock.resize });
  mock.catalog.mockResolvedValue({ a: { name: 'a' }, b: { name: 'b' } });
  visualizerSettings.reset();
  visualizerSettings.update({ style: 'milkdrop', milkDropPreset: 'a', milkDropCyclePresets: false });
  vi.stubGlobal('window', {
    devicePixelRatio: 2, localStorage: { setItem: vi.fn(), getItem: vi.fn() },
    addEventListener: vi.fn(), removeEventListener: vi.fn()
  });
  vi.stubGlobal('document', { get hidden() { return hidden; } });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  canvas = {
    width: 300, height: 150,
    getContext: vi.fn(() => ({ getExtension: () => ({ loseContext: mock.loseContext }) })),
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
    getClientRects: () => [{}], closest: () => inert ? {} : null,
    addEventListener: (name: string, callback: EventListener) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name)
  } as unknown as HTMLCanvasElement;
});

afterEach(() => {
  controller?.destroy();
  controller = null;
  visualizerService.clear();
  vi.unstubAllGlobals();
  visualizerSettings.reset();
});

describe('MilkDrop renderer lifecycle', () => {
  it('shows credits on visible entry and preset changes, expires them, and clears them on failure', async () => {
    const first = 'Flexi + Martin - astral projection';
    const second = 'Geiss - Spiral Artifact';
    mock.catalog.mockResolvedValue({ [first]: {}, [second]: {} });
    visualizerSettings.update({ milkDropPreset: first });
    const info = vi.fn();
    inert = true;
    controller = createMilkDropVisualizer(canvas, vi.fn(), info);
    await flushImports();
    renderFrame(0);
    expect(info).not.toHaveBeenCalled();
    inert = false;
    renderFrame(100);
    expect(info).toHaveBeenLastCalledWith({ name: 'astral projection', author: 'Flexi + Martin' });
    for (let index = 2; index <= 53; index++) renderFrame(index * 100);
    expect(info).toHaveBeenLastCalledWith(null);
    inert = true;
    renderFrame(5400);
    inert = false;
    renderFrame(5500);
    expect(info).toHaveBeenLastCalledWith({ name: 'astral projection', author: 'Flexi + Martin' });
    controller.randomizePreset();
    renderFrame(5600);
    expect(info).toHaveBeenLastCalledWith({ name: 'Spiral Artifact', author: 'Geiss' });
    hidden = true;
    renderFrame(5700);
    hidden = false;
    renderFrame(15000);
    expect(info).toHaveBeenLastCalledWith({ name: 'Spiral Artifact', author: 'Geiss' });
    mock.render.mockImplementationOnce(() => { throw new Error('Shader failure'); });
    renderFrame(15100);
    expect(info).toHaveBeenLastCalledWith(null);
  });

  it('samples the shared analyser, switches sources, and preserves audio graph ownership', async () => {
    const read = vi.fn((buffer: Uint8Array) => buffer.fill(143));
    const connect = vi.fn();
    const analyser = { context: {}, getByteTimeDomainData: read, connect } as unknown as AnalyserNode;
    visualizerService.setAnalyser(analyser);
    controller = createMilkDropVisualizer(canvas, vi.fn());
    await flushImports();
    renderFrame(0);
    expect(mock.create.mock.calls[0][0]).toBeNull();
    expect(read).toHaveBeenCalledOnce();
    expect(connect).not.toHaveBeenCalled();
    expect(mock.render.mock.calls[0][0].audioLevels.timeByteArray[0]).toBe(143);
    const nextRead = vi.fn((buffer: Uint8Array) => buffer.fill(150));
    visualizerService.setAnalyser({ context: {}, getByteTimeDomainData: nextRead } as unknown as AnalyserNode);
    renderFrame(20);
    expect(nextRead).toHaveBeenCalledOnce();
    visualizerService.clear();
    renderFrame(40);
    expect(mock.render.mock.calls[2][0].audioLevels.timeByteArray[0]).toBe(128);
  });

  it('honors frame caps, suspends hidden views, and applies live resolution changes', async () => {
    controller = createMilkDropVisualizer(canvas, vi.fn());
    await flushImports();
    renderFrame(0);
    renderFrame(1);
    expect(mock.render).toHaveBeenCalledOnce();
    hidden = true;
    renderFrame(20);
    hidden = false;
    inert = true;
    renderFrame(40);
    expect(mock.render).toHaveBeenCalledOnce();
    inert = false;
    renderFrame(6000);
    expect(mock.render).toHaveBeenCalledTimes(2);
    expect(mock.render.mock.calls[1][0].elapsedTime).toBeLessThanOrEqual(0.1);
    visualizerSettings.update({ milkDropResolution: 0.25 });
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
  });

  it('cycles and blends presets only when enabled, and accepts explicit live selection', async () => {
    controller = createMilkDropVisualizer(canvas, vi.fn());
    await flushImports();
    expect(mock.loadPreset).toHaveBeenLastCalledWith({ name: 'a' }, 0);
    for (let index = 0; index < 55; index++) renderFrame(index * 100);
    expect(mock.loadPreset).toHaveBeenCalledOnce();
    visualizerSettings.update({ milkDropCyclePresets: true, milkDropCycleSeconds: 5, milkDropBlendSeconds: 1.5 });
    for (let index = 55; index < 110; index++) renderFrame(index * 100);
    expect(mock.loadPreset).toHaveBeenLastCalledWith({ name: 'b' }, 1.5);
    visualizerSettings.update({ milkDropPreset: 'b', milkDropBlendSeconds: 0 });
    expect(mock.loadPreset).toHaveBeenLastCalledWith({ name: 'b' }, 0);
  });

  it('manually selects another preset with the configured blend without changing saved settings', async () => {
    visualizerSettings.update({ milkDropBlendSeconds: 1.5 });
    const settings = visualizerSettings.getSnapshot();
    controller = createMilkDropVisualizer(canvas, vi.fn());
    controller.randomizePreset();
    await flushImports();
    controller.randomizePreset();
    expect(mock.loadPreset).toHaveBeenLastCalledWith({ name: 'b' }, 1.5);
    controller.randomizePreset();
    expect(mock.loadPreset).toHaveBeenLastCalledWith({ name: 'a' }, 1.5);
    expect(visualizerSettings.getSnapshot()).toEqual(settings);
    controller.destroy();
    controller.randomizePreset();
    expect(mock.loadPreset).toHaveBeenCalledTimes(3);
    controller = null;
  });

  it('restarts the automatic cycle interval after a manual preset change', async () => {
    visualizerSettings.update({ milkDropCyclePresets: true, milkDropCycleSeconds: 5, milkDropBlendSeconds: 0 });
    controller = createMilkDropVisualizer(canvas, vi.fn());
    await flushImports();
    for (let index = 0; index < 40; index++) renderFrame(index * 100);
    controller.randomizePreset();
    for (let index = 40; index < 60; index++) renderFrame(index * 100);
    expect(mock.loadPreset).toHaveBeenCalledTimes(2);
    expect(mock.loadPreset).toHaveBeenLastCalledWith({ name: 'b' }, 0);
    for (let index = 60; index < 95; index++) renderFrame(index * 100);
    expect(mock.loadPreset).toHaveBeenCalledTimes(3);
    expect(mock.loadPreset).toHaveBeenLastCalledWith({ name: 'a' }, 0);
  });

  it('releases pending frames, subscriptions, and GL resources when unmounted', async () => {
    controller = createMilkDropVisualizer(canvas, vi.fn());
    await flushImports();
    controller.destroy();
    controller = null;
    expect(frames.size).toBe(0);
    expect(listeners.size).toBe(0);
    expect(mock.loseContext).toHaveBeenCalledOnce();
    visualizerSettings.update({ milkDropPreset: 'b' });
    expect(mock.loadPreset).toHaveBeenCalledOnce();
  });

  it('does not initialize after disposal while the lazy catalog is loading', async () => {
    let resolveCatalog: (catalog: Record<string, object>) => void = () => {};
    mock.catalog.mockReturnValue(new Promise<Record<string, object>>((resolve) => { resolveCatalog = resolve; }));
    controller = createMilkDropVisualizer(canvas, vi.fn());
    controller.destroy();
    controller = null;
    resolveCatalog({ a: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mock.create).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('reports unsupported WebGL and stops rendering after context loss', async () => {
    vi.mocked(canvas.getContext).mockReturnValueOnce(null);
    const status = vi.fn();
    controller = createMilkDropVisualizer(canvas, status);
    expect(status).toHaveBeenLastCalledWith('webgl-unavailable');
    expect(mock.create).not.toHaveBeenCalled();
    controller.destroy();
    controller = createMilkDropVisualizer(canvas, status);
    await flushImports();
    const event = { preventDefault: vi.fn() } as unknown as Event;
    listeners.get('webglcontextlost')!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith('context-lost');
    expect(frames.size).toBe(0);
  });

  it('contains preset/render errors without changing playback or leaving frames running', async () => {
    const status = vi.fn();
    controller = createMilkDropVisualizer(canvas, status);
    await flushImports();
    mock.render.mockImplementationOnce(() => { throw new Error('Shader failure'); });
    renderFrame(0);
    expect(status).toHaveBeenLastCalledWith('error');
    expect(frames.size).toBe(0);
  });

  it('reports initialization errors without blaming WebGL when a context exists', async () => {
    const status = vi.fn();
    mock.loadPreset.mockImplementationOnce(() => { throw new EvalError('Preset equation compilation blocked'); });
    controller = createMilkDropVisualizer(canvas, status);
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('error'));
    expect(mock.create).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('contains an exception when creating the graphics context', () => {
    vi.mocked(canvas.getContext).mockImplementationOnce(() => { throw new Error('Graphics context creation failed'); });
    const status = vi.fn();
    controller = createMilkDropVisualizer(canvas, status);
    expect(status).toHaveBeenLastCalledWith('webgl-unavailable');
    expect(mock.create).not.toHaveBeenCalled();
  });
});

describe('MilkDrop render sizing', () => {
  it('bounds high-DPI canvases while respecting the chosen resolution', () => {
    const size = getMilkDropRenderSize(3840, 2160, 2, 2);
    expect(size.width * size.height).toBeLessThanOrEqual(1_000_000);
    expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
    expect(getMilkDropRenderSize(800, 600, 1, 0.5)).toEqual({ width: 400, height: 300 });
    expect(getMilkDropRenderSize(0, 0, 1, 1)).toEqual({ width: 1, height: 1 });
  });
});
