import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioDocument, replaceAudioDocumentRange } from './audio-document';
import { createWaveformRenderer, type WaveformRenderState } from './waveform-renderer';
import { testAudioBuffer } from './test-audio-buffer';

describe('waveform render invalidation', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let themeChanged: () => void;
  let resized: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    frames.clear(); nextFrame = 0;
    vi.stubGlobal('window', { devicePixelRatio: 2, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { documentElement: {}, body: {} });
    vi.stubGlobal('getComputedStyle', vi.fn(() => ({ getPropertyValue: () => '' })));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {} disconnect() {}
    });
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { themeChanged = callback; }
      observe() {} disconnect() {}
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function paint(): void {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(1000);
  }

  function surface(height: number) {
    const context = {
      fillRect: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      stroke: vi.fn(), fill: vi.fn(), closePath: vi.fn(), fillText: vi.fn(), strokeRect: vi.fn()
    };
    const canvas = {
      width: 0, height: 0, getContext: vi.fn(() => context),
      getBoundingClientRect: vi.fn(() => ({ width: 1000, height }))
    };
    return { canvas: canvas as unknown as HTMLCanvasElement, context, rect: canvas.getBoundingClientRect };
  }

  it('moves cursors without canvas repaint, layout reads, or style resolution', async () => {
    const main = surface(500); const selection = surface(500);
    const overview = surface(48); const overviewSelection = surface(48);
    const cursor = { hidden: true, style: { transform: '' } } as HTMLElement;
    const overviewCursor = { hidden: true, style: { transform: '' } } as HTMLElement;
    const renderer = createWaveformRenderer(main.canvas, selection.canvas, cursor,
      overview.canvas, overviewSelection.canvas, overviewCursor, vi.fn(), vi.fn());
    const state: WaveformRenderState = {
      document: createAudioDocument(testAudioBuffer([Array.from({ length: 10_000 }, (_, i) => Math.sin(i))], 1000)),
      selectionStart: 1, selectionEnd: 3, playhead: 0, zoom: 1, scrollStart: 0, twoChannelView: false
    };
    renderer.update(state);
    await vi.runAllTimersAsync();
    paint();
    vi.clearAllMocks();
    for (let position = 0; position < 1; position += 0.02) {
      renderer.update({ ...state, playhead: position });
      paint();
    }
    expect(main.context.fillRect).not.toHaveBeenCalled();
    expect(overview.context.fillRect).not.toHaveBeenCalled();
    expect(selection.context.clearRect).not.toHaveBeenCalled();
    expect(overviewSelection.context.clearRect).not.toHaveBeenCalled();
    expect(selection.rect).not.toHaveBeenCalled();
    expect(overviewSelection.rect).not.toHaveBeenCalled();
    expect(getComputedStyle).not.toHaveBeenCalled();
    expect(cursor.hidden).toBe(false);
    expect(cursor.style.transform).toContain('translateX(');
    renderer.destroy();
  });

  it('coalesces viewport changes, retains the overview and reuses prepared source peaks across edits', async () => {
    const main = surface(500); const selection = surface(500);
    const overview = surface(48); const overviewSelection = surface(48);
    const cursor = () => ({ hidden: true, style: {} }) as HTMLElement;
    const preparing = vi.fn();
    const renderer = createWaveformRenderer(main.canvas, selection.canvas, cursor(),
      overview.canvas, overviewSelection.canvas, cursor(), preparing, vi.fn());
    const state: WaveformRenderState = {
      document: createAudioDocument(testAudioBuffer([Array.from({ length: 10_000 }, (_, i) => Math.sin(i))], 1000)),
      selectionStart: 0, selectionEnd: 1, playhead: 0, zoom: 1, scrollStart: 0, twoChannelView: false
    };
    renderer.update(state);
    await vi.runAllTimersAsync(); paint(); vi.clearAllMocks();
    for (let i = 0; i < 100; i += 1) renderer.update({ ...state, zoom: 4, scrollStart: i / 100 });
    expect(frames.size).toBe(1); paint();
    expect(main.context.fillRect).toHaveBeenCalledTimes(1);
    expect(overview.context.fillRect).not.toHaveBeenCalled();
    vi.clearAllMocks();
    renderer.update({ ...state, document: replaceAudioDocumentRange(state.document!, 2, 4, null) });
    paint();
    expect(preparing).not.toHaveBeenCalledWith(true);
    expect(main.context.fillRect).toHaveBeenCalledTimes(1);
    expect(overview.context.fillRect).toHaveBeenCalledTimes(1);
    vi.clearAllMocks(); themeChanged(); paint();
    expect(getComputedStyle).toHaveBeenCalledTimes(1);
    expect(main.context.fillRect).toHaveBeenCalledTimes(1);
    vi.clearAllMocks(); resized();
    expect(frames.size).toBe(0);
    renderer.destroy();
  });

  it('animates directly from the audio clock while UI clock values stay unchanged', async () => {
    const main = surface(500); const selection = surface(500); const overview = surface(48); const overviewSelection = surface(48);
    const cursor = { hidden: true, style: { transform: '' } } as HTMLElement;
    const renderer = createWaveformRenderer(main.canvas, selection.canvas, cursor, overview.canvas, overviewSelection.canvas,
      { style: {} } as HTMLElement, vi.fn(), vi.fn());
    let position = 0;
    const state: WaveformRenderState = {
      document: createAudioDocument(testAudioBuffer([[1, 2, 3, 4, 5]], 1)),
      selectionStart: 0, selectionEnd: 0, playhead: 0, zoom: 1, scrollStart: 0,
      twoChannelView: false, playbackPosition: () => position
    };
    renderer.update(state);
    await vi.runAllTimersAsync(); paint(); vi.clearAllMocks();
    position = 2;
    paint();
    expect(cursor.style.transform).toBe('translateX(400px)');
    expect(main.context.fillRect).not.toHaveBeenCalled();
    expect(selection.context.clearRect).not.toHaveBeenCalled();
    expect(selection.rect).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    renderer.update({ ...state, playhead: position, playbackPosition: null });
    paint();
    expect(frames.size).toBe(0);
    renderer.destroy();
  });

  it('cancels pending preparation on replacement/unmount without publishing old failures', async () => {
    const main = surface(500); const overlay = surface(500); const overview = surface(48); const overviewOverlay = surface(48);
    const cursor = () => ({ style: {} }) as HTMLElement;
    const preparing = vi.fn(); const failed = vi.fn();
    const renderer = createWaveformRenderer(main.canvas, overlay.canvas, cursor(),
      overview.canvas, overviewOverlay.canvas, cursor(), preparing, failed);
    renderer.update({ document: createAudioDocument(testAudioBuffer([[1, 2, 3]])),
      selectionStart: 0, selectionEnd: 0, playhead: 0, zoom: 1, scrollStart: 0, twoChannelView: false });
    renderer.destroy();
    await vi.runAllTimersAsync();
    expect(failed).not.toHaveBeenCalled();
    expect(preparing).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
});
