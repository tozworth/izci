import type { MilkDropVisualizer } from 'butterchurn';
import { visualizerService } from './visualizer';
import { chooseMilkDropPreset, getMilkDropPresetInfo, loadMilkDropPresets, type MilkDropPresetInfo } from './milkdrop-presets';
import { visualizerSettings } from '$lib/stores/visualizer-settings';
import { logWarning } from './logging';

export type MilkDropStatus = 'loading' | 'ready' | 'webgl-unavailable' | 'context-lost' | 'error';
type MilkDropFailure = Exclude<MilkDropStatus, 'loading' | 'ready'>;
const MAX_BACKING_PIXELS = 1_000_000;
const MAX_FRAME_SECONDS = 0.1;
const PRESET_INFO_SECONDS = 5;

export function getMilkDropRenderSize(width: number, height: number, pixelRatio: number, resolution: number) {
  const scale = Math.min(Math.max(1, pixelRatio) * resolution, Math.sqrt(MAX_BACKING_PIXELS / Math.max(1, width * height)));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  };
}

export function createMilkDropVisualizer(
  canvas: HTMLCanvasElement,
  setStatus: (status: MilkDropStatus) => void,
  setPresetInfo?: (info: MilkDropPresetInfo | null) => void
) {
  let settings = visualizerSettings.getSnapshot();
  let analyser: AnalyserNode | null = null;
  let renderer: MilkDropVisualizer | null = null;
  let presets: Record<string, object> = {};
  let names: string[] = [];
  let currentPreset: string | null = null;
  let presetElapsedSeconds = 0;
  let presetInfoPending = false;
  let presetInfoElapsedSeconds = 0;
  let presetInfoVisible = false;
  let lastRenderedAt: number | null = null;
  let frame: number | null = null;
  let destroyed = false;
  let failed = false;
  const samples = new Uint8Array(1024).fill(128);
  const audioLevels = { timeByteArray: samples, timeByteArrayL: samples, timeByteArrayR: samples };
  let gl: WebGL2RenderingContext | null = null;

  function fail(error?: unknown, reason: MilkDropFailure = 'error') {
    if (failed || destroyed) return;
    failed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    renderer = null;
    setPresetInfo?.(null);
    setStatus(reason);
    logWarning('system', `MilkDrop rendering stopped (${reason})`, error);
  }

  function resize() {
    if (!renderer || failed || destroyed) return;
    const rect = canvas.getBoundingClientRect();
    const size = getMilkDropRenderSize(rect.width, rect.height, window.devicePixelRatio || 1, settings.milkDropResolution);
    if (canvas.width === size.width && canvas.height === size.height) return;
    canvas.width = size.width;
    canvas.height = size.height;
    try {
      renderer.setRendererSize(size.width, size.height, { pixelRatio: 1 });
    } catch (error) {
      fail(error);
    }
  }

  function loadPreset(requested = '', blendSeconds = settings.milkDropBlendSeconds) {
    const name = chooseMilkDropPreset(names, requested, currentPreset);
    if (!renderer || !name) return;
    renderer.loadPreset(presets[name], blendSeconds);
    currentPreset = name;
    presetElapsedSeconds = 0;
    presetInfoPending = true;
  }

  function draw(timestamp: number) {
    frame = null;
    if (destroyed || failed || !renderer) return;
    if (document.hidden || canvas.closest('[inert]') || canvas.getClientRects().length === 0) {
      lastRenderedAt = null;
      frame = requestAnimationFrame(draw);
      return;
    }
    if (lastRenderedAt !== null && timestamp - lastRenderedAt + 0.75 < 1000 / settings.frameRateLimit) {
      frame = requestAnimationFrame(draw);
      return;
    }
    const entering = lastRenderedAt === null;
    const elapsed = lastRenderedAt === null ? 1 / settings.frameRateLimit
      : Math.min(MAX_FRAME_SECONDS, Math.max(0.001, (timestamp - lastRenderedAt) / 1000));
    lastRenderedAt = timestamp;
    try {
      // Feed the existing post-Raf analyser's PCM into Butterchurn. It never
      // connects to the graph, changes the shared FFT, or creates an audio output.
      samples.fill(128);
      analyser?.getByteTimeDomainData(samples);
      presetElapsedSeconds += elapsed;
      if (settings.milkDropCyclePresets && presetElapsedSeconds >= Math.max(settings.milkDropCycleSeconds, settings.milkDropBlendSeconds)) {
        loadPreset();
      }
      renderer.render({ elapsedTime: elapsed, audioLevels });
      if (setPresetInfo && currentPreset) {
        if (entering || presetInfoPending) {
          setPresetInfo(getMilkDropPresetInfo(currentPreset));
          presetInfoElapsedSeconds = 0;
          presetInfoVisible = true;
          presetInfoPending = false;
        } else if (presetInfoVisible) {
          presetInfoElapsedSeconds += elapsed;
          if (presetInfoElapsedSeconds >= PRESET_INFO_SECONDS) {
            setPresetInfo(null);
            presetInfoVisible = false;
          }
        }
      }
    } catch (error) {
      fail(error);
      return;
    }
    frame = requestAnimationFrame(draw);
  }

  const unsubscribeSource = visualizerService.source.subscribe((source) => {
    analyser = source?.analyser ?? null;
  });
  const unsubscribeSettings = visualizerSettings.subscribe((next) => {
    const previous = settings;
    settings = next;
    if (renderer) {
      try {
        if (previous.milkDropPreset !== next.milkDropPreset) loadPreset(next.milkDropPreset);
        if (previous.milkDropCyclePresets !== next.milkDropCyclePresets) presetElapsedSeconds = 0;
        if (previous.milkDropResolution !== next.milkDropResolution) resize();
      } catch (error) {
        fail(error);
      }
    }
  });
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  observer?.observe(canvas);
  window.addEventListener('resize', resize);
  function onContextLost(event: Event) {
    event.preventDefault();
    fail(undefined, 'context-lost');
  }
  canvas.addEventListener('webglcontextlost', onContextLost);

  async function initialize() {
    setStatus('loading');
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false
      });
    } catch (error) {
      fail(error, 'webgl-unavailable');
      return;
    }
    if (!gl) {
      fail(undefined, 'webgl-unavailable');
      return;
    }
    try {
      const [{ default: butterchurn }, catalog] = await Promise.all([import('butterchurn'), loadMilkDropPresets()]);
      if (destroyed || failed) return;
      presets = catalog;
      names = Object.keys(presets).sort();
      if (!names.length) throw new Error('MilkDrop preset catalog is empty.');
      renderer = butterchurn.createVisualizer(null, canvas, { width: canvas.width, height: canvas.height, pixelRatio: 1 });
      resize();
      if (failed) return;
      loadPreset(settings.milkDropPreset, 0);
      setStatus('ready');
      frame = requestAnimationFrame(draw);
    } catch (error) {
      fail(error);
    }
  }
  void initialize();

  return {
    randomizePreset() {
      if (destroyed || failed || !renderer) return;
      try {
        loadPreset();
      } catch (error) {
        fail(error);
      }
    },
    destroy() {
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      unsubscribeSource();
      unsubscribeSettings();
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      renderer = null;
      // Butterchurn has no disposal API; release all resources in this canvas's
      // context. Each mounted visualizer owns its own canvas and GL context.
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}
