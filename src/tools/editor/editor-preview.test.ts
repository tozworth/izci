import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioDocument, replaceAudioDocumentRange, sliceAudioDocument } from './audio-document';
import { createEditorPreview } from './editor-preview';
import { testAudioBuffer } from './test-audio-buffer';

describe('editor segment preview', () => {
  const nodes: Array<{ buffer: AudioBuffer | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended: (() => void) | null }> = [];
  let clock = 0;
  let resume: () => Promise<void>;
  let frameCallback: FrameRequestCallback;
  let visibilityCallback: () => void;
  let hidden = false;
  const positions = vi.fn();
  const playing = vi.fn();

  beforeEach(() => {
    nodes.length = 0;
    clock = 0;
    hidden = false;
    resume = () => Promise.resolve();
    positions.mockClear(); playing.mockClear();
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', {
      get hidden() { return hidden; },
      addEventListener: (_: string, callback: () => void) => { visibilityCallback = callback; }, removeEventListener: vi.fn()
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frameCallback = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('AudioContext', class {
      get currentTime() { return clock; }
      destination = {};
      resume() { return resume(); }
      close() { return Promise.resolve(); }
      createBufferSource() {
        const node = { buffer: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null };
        nodes.push(node);
        return node;
      }
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('schedules sample-exact joins and uses the audio clock for the cursor', async () => {
    const original = createAudioDocument(testAudioBuffer([Array.from({ length: 20 }, (_, i) => i)]));
    const document = replaceAudioDocumentRange(original, 0.5, 1, null);
    const preview = createEditorPreview({ position: positions, playing });
    await preview.start(document, 0.2, 1.2);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].buffer).toBe(original.segments[0].buffer);
    expect(nodes[0].start).toHaveBeenCalledWith(0.015, 0.2, 0.3);
    expect(nodes[1].start).toHaveBeenCalledWith(0.315, 1, 0.7);
    clock = 0.515;
    frameCallback(1000);
    expect(preview.position()).toBeCloseTo(0.7);
    expect(positions).toHaveBeenLastCalledWith(0.7);
    preview.stop();
    expect(nodes.every((node) => node.stop.mock.calls.length === 1)).toBe(true);
    expect(playing).toHaveBeenLastCalledWith(false);
    preview.destroy();
  });

  it('does not resurrect playback after stop while AudioContext.resume is pending', async () => {
    let release: () => void = () => undefined;
    resume = () => new Promise<void>((resolve) => { release = resolve; });
    const preview = createEditorPreview({ position: positions, playing });
    const document = createAudioDocument(testAudioBuffer([[1, 2, 3]]));
    const pending = preview.start(document, 0, document.duration);
    preview.stop();
    release();
    await pending;
    expect(nodes).toHaveLength(0);
    expect(playing).not.toHaveBeenCalledWith(true);
    preview.destroy();
  });

  it('finishes a selection inside an edit segment without waiting for background UI timers', async () => {
    hidden = true;
    const original = createAudioDocument(testAudioBuffer([Array.from({ length: 20 }, (_, i) => i)]));
    const document = replaceAudioDocumentRange(original, 0.5, 1, null);
    const preview = createEditorPreview({ position: positions, playing });
    await preview.start(document, 0.2, 1.2);
    clock = 1.015;
    nodes.at(-1)?.onended?.();
    expect(playing).toHaveBeenLastCalledWith(false);
    expect(preview.position()).toBeCloseTo(1.2);
    expect(positions).toHaveBeenLastCalledWith(1.2);
    preview.destroy();
  });

  it('limits visible-window lookahead and schedules remaining edits before background throttling', async () => {
    const original = createAudioDocument(testAudioBuffer([Array.from({ length: 100 }, (_, i) => i)]));
    const insert = sliceAudioDocument(original, 1, 2);
    let document = original;
    for (let i = 0; i < 8; i += 1) document = replaceAudioDocumentRange(document, i, i, insert);
    const preview = createEditorPreview({ position: positions, playing });
    await preview.start(document, 0, document.duration);
    expect(nodes.length).toBeLessThan(document.segments.length);
    hidden = true;
    visibilityCallback();
    expect(nodes).toHaveLength(document.segments.length);
    preview.destroy();
  });
});
