import { documentSegmentAt, type AudioDocument } from './audio-document';
import {
  prepareWaveformPeakPyramid, waveformPeakBucketSize, waveformPeakRange,
  type WaveformPeakPyramid
} from './waveform-peaks';
import { clampWaveformScrollStart, normalizeWaveformZoom, waveformViewportDuration } from './waveform-viewport';

export interface WaveformRenderState {
  document: AudioDocument | null;
  selectionStart: number;
  selectionEnd: number;
  playhead: number;
  zoom: number;
  scrollStart: number;
  twoChannelView: boolean;
  playbackPosition?: (() => number) | null;
}

interface Surface {
  base: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  cursor: HTMLElement;
  width: number;
  height: number;
  ratio: number;
}

const MAIN = 1;
const OVERVIEW = 2;
const SELECTION = 4;
const CURSOR = 8;
const ALL = MAIN | OVERVIEW | SELECTION | CURSOR;
// Weak keys let history eviction/file replacement release both PCM and peak data.
const peakCache = new WeakMap<AudioBuffer, WaveformPeakPyramid>();

export function formatWaveformTime(value: number, step = 1): string {
  const safeValue = Math.max(0, value);
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor(safeValue % 3600 / 60);
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const seconds = (safeValue % 60).toFixed(digits).padStart(digits ? digits + 3 : 2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** One frame scheduler. Transport updates touch two thin DOM cursors only. */
export function createWaveformRenderer(
  mainBase: HTMLCanvasElement,
  mainOverlay: HTMLCanvasElement,
  mainCursor: HTMLElement,
  overviewBase: HTMLCanvasElement,
  overviewOverlay: HTMLCanvasElement,
  overviewCursor: HTMLElement,
  preparing: (busy: boolean) => void,
  failed: (error: unknown) => void
) {
  const main: Surface = { base: mainBase, overlay: mainOverlay, cursor: mainCursor, width: 1, height: 1, ratio: 1 };
  const overview: Surface = { base: overviewBase, overlay: overviewOverlay, cursor: overviewCursor, width: 1, height: 1, ratio: 1 };
  let state: WaveformRenderState = {
    document: null, selectionStart: 0, selectionEnd: 0, playhead: 0, zoom: 1, scrollStart: 0, twoChannelView: false
  };
  let frame = 0;
  let dirty = ALL;
  let colors: Record<string, string> = {};
  let preparation: AbortController | null = null;
  let destroyed = false;

  function color(name: string, fallback: string): string { return colors[name] || fallback; }

  function readColors(): void {
    const styles = getComputedStyle(mainOverlay);
    for (const name of [
      'background', 'color', 'zero', 'grid', 'ruler', 'selection', 'handle',
      'overview-background', 'overview-color', 'overview-selection', 'overview-outside', 'overview-viewport'
    ]) colors[name] = styles.getPropertyValue(`--waveform-${name}`).trim();
    request(ALL);
  }

  function resize(surface: Surface): void {
    const rect = surface.overlay.getBoundingClientRect();
    // Waveform geometry uses CSS pixels; extra device pixels improve edges only.
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (surface.width === width && surface.height === height && surface.ratio === ratio) return;
    surface.width = width;
    surface.height = height;
    surface.ratio = ratio;
    for (const canvas of [surface.base, surface.overlay]) { canvas.width = width; canvas.height = height; }
    request(surface === main ? MAIN | SELECTION | CURSOR : OVERVIEW | SELECTION | CURSOR);
  }

  function viewport() {
    const duration = state.document?.duration ?? 0;
    const visible = waveformViewportDuration(duration, state.zoom);
    const start = clampWaveformScrollStart(state.scrollStart, duration, state.zoom);
    return { duration, visible, start };
  }

  function drawAudio(context: CanvasRenderingContext2D, surface: Surface, start: number, seconds: number, overviewMode: boolean): void {
    const document = state.document;
    if (!document || document.length === 0 || seconds <= 0) return;
    const { width, height, ratio } = surface;
    const samplesPerPixel = seconds * document.sampleRate / (width / ratio);
    const size = waveformPeakBucketSize(samplesPerPixel);
    const firstFrame = start * document.sampleRate;
    const lastFrame = Math.min(document.length, firstFrame + seconds * document.sampleRate);
    const channels = Math.min(document.numberOfChannels, state.twoChannelView ? 2 : 1);
    const laneHeight = height / channels;
    const peak = { minimum: 0, maximum: 0 };
    context.strokeStyle = overviewMode ? color('overview-color', '#74808c') : color('color', '#aeb7c2');
    context.lineWidth = ratio;
    for (let channel = 0; channel < channels; channel += 1) {
      const middle = laneHeight * (channel + 0.5);
      context.beginPath();
      for (let index = documentSegmentAt(document, firstFrame); index < document.segments.length; index += 1) {
        const segment = document.segments[index];
        const offset = document.offsets[index];
        if (offset >= lastFrame) break;
        const peaks = peakCache.get(segment.buffer);
        if (!peaks) continue;
        const sourceStart = segment.start + Math.max(0, firstFrame - offset);
        const sourceEnd = Math.min(segment.end, segment.start + lastFrame - offset);
        if (samplesPerPixel < 1) {
          // Individual samples at deep zoom form a connected signal, not zero-height bars.
          const data = segment.buffer.getChannelData(channel);
          for (let sample = Math.floor(sourceStart); sample < sourceEnd; sample += 1) {
            const x = (offset + sample - segment.start - firstFrame) / samplesPerPixel * ratio;
            const y = middle - data[sample] * laneHeight * 0.38;
            if (sample === Math.floor(sourceStart)) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
        } else {
          for (let bucket = Math.floor(sourceStart / size) * size; bucket < sourceEnd; bucket += size) {
            const from = Math.max(bucket, sourceStart);
            const to = Math.min(bucket + size, sourceEnd);
            waveformPeakRange(peaks, channel, from, to, peak);
            const x = (offset + (from + to) / 2 - segment.start - firstFrame) / samplesPerPixel * ratio;
            context.moveTo(x, middle - peak.maximum * laneHeight * 0.38);
            context.lineTo(x, middle - peak.minimum * laneHeight * 0.38);
          }
        }
      }
      context.stroke();
    }
  }

  function drawTimeline(context: CanvasRenderingContext2D, start: number, seconds: number): void {
    if (seconds <= 0) return;
    const { width, height, ratio } = main;
    const rawStep = seconds / Math.max(2, width / ratio / 90);
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 0.001)));
    const normalized = rawStep / magnitude;
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    context.strokeStyle = color('grid', 'rgba(255,255,255,0.08)');
    context.fillStyle = color('ruler', '#8d949d');
    context.lineWidth = ratio;
    context.font = `${10 * ratio}px system-ui, sans-serif`;
    context.textBaseline = 'top';
    context.beginPath();
    for (let time = Math.ceil(start / step) * step; time <= start + seconds + step * 0.001; time += step) {
      const x = (time - start) / seconds * width;
      context.moveTo(Math.round(x) + 0.5, 0);
      context.lineTo(Math.round(x) + 0.5, height);
      context.fillText(formatWaveformTime(time, step), x + 4 * ratio, 4 * ratio);
    }
    context.stroke();
  }

  function drawBase(surface: Surface, overviewMode: boolean): void {
    const context = surface.base.getContext('2d');
    if (!context) return;
    const { width, height, ratio } = surface;
    const { duration, visible, start } = viewport();
    context.fillStyle = overviewMode ? color('overview-background', '#111315') : color('background', '#17191c');
    context.fillRect(0, 0, width, height);
    if (!overviewMode) drawTimeline(context, start, visible);
    drawAudio(context, surface, overviewMode ? 0 : start, overviewMode ? duration : visible, overviewMode);
    context.strokeStyle = color('zero', '#4b5057');
    context.lineWidth = ratio;
    context.globalAlpha = 0.5;
    context.beginPath();
    const channels = Math.min(state.document?.numberOfChannels ?? 1, state.twoChannelView ? 2 : 1);
    for (let channel = 0; channel < channels; channel += 1) {
      const y = Math.round(height / channels * (channel + 0.5)) + 0.5;
      context.moveTo(0, y); context.lineTo(width, y);
    }
    context.stroke();
    context.globalAlpha = 1;
  }

  function drawSelection(surface: Surface, overviewMode: boolean): void {
    const context = surface.overlay.getContext('2d');
    if (!context) return;
    const { width, height, ratio } = surface;
    const { duration, visible, start } = viewport();
    context.clearRect(0, 0, width, height);
    const seconds = overviewMode ? duration : visible;
    if (!state.document || seconds <= 0) return;
    const origin = overviewMode ? 0 : start;
    const x = (state.selectionStart - origin) / seconds * width;
    const endX = (state.selectionEnd - origin) / seconds * width;
    context.fillStyle = overviewMode ? color('overview-selection', 'rgba(154,190,224,0.2)') : color('selection', 'rgba(197,204,214,0.14)');
    context.fillRect(Math.max(0, x), 0, Math.max(0, Math.min(width, endX) - Math.max(0, x)), height);
    context.lineWidth = ratio;
    if (overviewMode) {
      const viewportX = start / duration * width;
      const viewportWidth = Math.max(2 * ratio, visible / duration * width);
      context.fillStyle = color('overview-outside', 'rgba(0,0,0,0.46)');
      context.fillRect(0, 0, viewportX, height);
      context.fillRect(viewportX + viewportWidth, 0, Math.max(0, width - viewportX - viewportWidth), height);
      context.strokeStyle = color('overview-viewport', '#c6d0dc');
      context.strokeRect(viewportX + 0.5 * ratio, 0.5 * ratio,
        Math.max(1, Math.min(width - viewportX - ratio, viewportWidth - ratio)), Math.max(1, height - ratio));
      if (normalizeWaveformZoom(state.zoom) > 1) {
        context.fillStyle = color('overview-viewport', '#c6d0dc');
        const handle = Math.max(2 * ratio, Math.min(4 * ratio, viewportWidth * 0.08));
        context.fillRect(viewportX, height * 0.28, handle, height * 0.44);
        context.fillRect(viewportX + viewportWidth - handle, height * 0.28, handle, height * 0.44);
      }
    } else {
      context.strokeStyle = context.fillStyle = color('handle', '#d8dee7');
      context.beginPath();
      for (const edge of [x, endX]) {
        if (edge < 0 || edge > width) continue;
        context.moveTo(edge, 0); context.lineTo(edge, height);
      }
      context.stroke();
      for (const edge of [x, endX]) {
        if (edge < 0 || edge > width) continue;
        context.beginPath();
        context.moveTo(edge, 0); context.lineTo(edge + (edge === x ? 7 : -7) * ratio, 0);
        context.lineTo(edge, 7 * ratio); context.closePath(); context.fill();
      }
    }
  }

  function moveCursors(): void {
    const { duration, visible, start } = viewport();
    const playhead = state.playbackPosition?.() ?? state.playhead;
    for (const surface of [main, overview]) {
      const origin = surface === main ? start : 0;
      const seconds = surface === main ? visible : duration;
      const shown = Boolean(state.document && seconds > 0 && playhead >= origin && playhead <= origin + seconds);
      surface.cursor.hidden = !shown;
      if (shown) surface.cursor.style.transform = `translateX(${Math.min(surface.width / surface.ratio - 1,
        (playhead - origin) / seconds * surface.width / surface.ratio)}px)`;
    }
  }

  function paint(): void {
    frame = 0;
    const work = dirty;
    dirty = 0;
    if (work & MAIN) drawBase(main, false);
    if (work & OVERVIEW) drawBase(overview, true);
    if (work & SELECTION) { drawSelection(main, false); drawSelection(overview, true); }
    if (work & CURSOR) moveCursors();
    if (state.playbackPosition) request(CURSOR);
  }

  function request(work: number): void {
    if (destroyed) return;
    dirty |= work;
    if (!frame) frame = requestAnimationFrame(paint);
  }

  async function prepare(document: AudioDocument | null): Promise<void> {
    preparation?.abort();
    const controller = new AbortController();
    preparation = controller;
    const buffers = [...new Set(document?.segments.map((segment) => segment.buffer) ?? [])];
    const missing = buffers.filter((buffer) => !peakCache.has(buffer));
    preparing(missing.length > 0);
    try {
      for (const buffer of missing) {
        const readers = Array.from({ length: Math.min(2, buffer.numberOfChannels) },
          (_, channel) => () => buffer.getChannelData(channel));
        const peaks = await prepareWaveformPeakPyramid(readers.map((read) => read()), controller.signal, readers);
        peakCache.set(buffer, peaks);
        request(MAIN | OVERVIEW);
      }
    } catch (error) {
      if (!controller.signal.aborted) failed(error);
    } finally {
      if (preparation === controller && !destroyed) preparing(false);
    }
  }

  const resizeObserver = new ResizeObserver(() => { resize(main); resize(overview); });
  resizeObserver.observe(mainOverlay);
  resizeObserver.observe(overviewOverlay);
  const themeObserver = new MutationObserver(readColors);
  const observerOptions = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] };
  themeObserver.observe(document.documentElement, observerOptions);
  themeObserver.observe(document.body, observerOptions);
  const onResize = () => { resize(main); resize(overview); };
  window.addEventListener('resize', onResize);
  resize(main); resize(overview); readColors();

  return {
    update(next: WaveformRenderState): void {
      let work = 0;
      if (next.document !== state.document) { work = ALL; void prepare(next.document); }
      if (next.twoChannelView !== state.twoChannelView) work |= MAIN | OVERVIEW;
      if (next.zoom !== state.zoom || next.scrollStart !== state.scrollStart) work |= MAIN | SELECTION | CURSOR;
      if (next.selectionStart !== state.selectionStart || next.selectionEnd !== state.selectionEnd) work |= SELECTION;
      if (next.playhead !== state.playhead || next.playbackPosition !== state.playbackPosition) work |= CURSOR;
      // Copy primitives so callers cannot mutate the previous comparison snapshot.
      state = { ...next };
      if (work) request(work);
    },
    destroy(): void {
      destroyed = true;
      preparation?.abort();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      window.removeEventListener('resize', onResize);
    }
  };
}
