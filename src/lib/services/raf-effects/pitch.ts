import type { RafPitchEngine, RafPitchSettings } from '$lib/types';
import { disconnectNode, setAudioParam, type RafEffectNode } from './shared';

export const PITCH_SEMITONES_MIN = -12;
export const PITCH_SEMITONES_MAX = 12;

export const PITCH_WINDOW_SIZES = [1024, 2048, 4096] as const;
export const PITCH_DEFAULT_WINDOW_SIZE = 2048;
export const PITCH_MAX_PEAKS_OPTIONS = [16, 32, 64, 128] as const;
export const PITCH_DEFAULT_MAX_PEAKS = 64;
export const PITCH_PEAK_FLOOR_OPTIONS = [-40, -60, -80] as const;
export const PITCH_DEFAULT_PEAK_FLOOR_DB = -60;
export const PITCH_GRAIN_SIZES = [1024, 2048, 4096] as const;
export const PITCH_DEFAULT_GRAIN_SIZE = 2048;
export const PITCH_ALIGNMENT_OPTIONS = [128, 256, 512] as const;
export const PITCH_DEFAULT_ALIGNMENT_WINDOW = 256;

export function isRafPitchEngine(value: unknown): value is RafPitchEngine {
  return value === 'phase-vocoder' || value === 'granular';
}

interface PitchEngineDescriptor {
  processor: string;
  url: string;
}

const PITCH_ENGINES: Record<RafPitchEngine, PitchEngineDescriptor> = {
  'phase-vocoder': { processor: 'raf-pitch', url: '/raf-pitch.worklet.js' },
  granular: { processor: 'raf-pitch-granular', url: '/raf-pitch-granular.worklet.js' }
};

const pitchWorkletLoads = new WeakMap<BaseAudioContext, Map<string, Promise<boolean>>>();

export interface PitchNode extends RafEffectNode {
  input: GainNode;
  output: GainNode;
  worklet: AudioWorkletNode | null;
  pitchParam: AudioParam | null;
  nodes: AudioNode[];
  latestSettings: RafPitchSettings;
  disposed: boolean;
  ready: Promise<void>;
}

export function semitoneToFactor(semitones: number): number {
  return 2 ** (clamp(semitones, PITCH_SEMITONES_MIN, PITCH_SEMITONES_MAX) / 12);
}

export function createPitchNode(context: BaseAudioContext, settings: RafPitchSettings): PitchNode {
  const input = context.createGain();
  const output = context.createGain();
  // The dry path keeps the rack live while the worklet module loads; the
  // processor rewires through the worklet once it is registered.
  input.connect(output);
  const node: PitchNode = {
    input,
    output,
    worklet: null,
    pitchParam: null,
    nodes: [input, output],
    latestSettings: settings,
    disposed: false,
    ready: Promise.resolve()
  };
  node.ready = activatePitchProcessor(node, context, settings.engine);
  return node;
}

export function updatePitchNode(
  node: PitchNode,
  settings: RafPitchSettings,
  context: BaseAudioContext,
  previousSettings?: RafPitchSettings
): void {
  const previous = previousSettings ?? node.latestSettings;
  node.latestSettings = settings;

  if (previous.engine !== settings.engine) {
    // Swap the worklet for the other engine; the dry path stays live while
    // the new module loads.
    node.ready = activatePitchProcessor(node, context, settings.engine);
    return;
  }

  const worklet = node.worklet;
  if (!worklet) return;

  if (previous.semitones !== settings.semitones && node.pitchParam) {
    setAudioParam(node.pitchParam, semitoneToFactor(settings.semitones), context);
  }

  if (settings.engine === 'phase-vocoder') {
    if (previous.windowSize !== settings.windowSize) {
      setParamInstant(worklet.parameters.get('windowSize'), settings.windowSize);
    }
    if (previous.maxPeaks !== settings.maxPeaks) {
      setParamInstant(worklet.parameters.get('maxPeaks'), settings.maxPeaks);
    }
    if (previous.peakFloorDb !== settings.peakFloorDb) {
      setParamInstant(worklet.parameters.get('peakFloorDb'), settings.peakFloorDb);
    }
  } else {
    if (previous.grainSize !== settings.grainSize) {
      setParamInstant(worklet.parameters.get('grainSize'), settings.grainSize);
    }
    if (previous.alignmentWindow !== settings.alignmentWindow) {
      setParamInstant(worklet.parameters.get('alignmentWindow'), settings.alignmentWindow);
    }
  }
}

export function disposePitchNode(node: PitchNode): void {
  node.disposed = true;
  node.nodes.forEach(disconnectNode);
}

async function activatePitchProcessor(node: PitchNode, context: BaseAudioContext, engine: RafPitchEngine): Promise<void> {
  const descriptor = PITCH_ENGINES[engine];
  if (!await ensurePitchWorklet(context, descriptor.url) || node.disposed) return;
  // A newer activation may have started while the module was loading.
  if (node.latestSettings.engine !== engine) return;

  let worklet: AudioWorkletNode | null = null;
  try {
    worklet = new AudioWorkletNode(context, descriptor.processor, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      parameterData: {
        pitch: semitoneToFactor(node.latestSettings.semitones),
        windowSize: node.latestSettings.windowSize,
        maxPeaks: node.latestSettings.maxPeaks,
        peakFloorDb: node.latestSettings.peakFloorDb,
        grainSize: node.latestSettings.grainSize,
        alignmentWindow: node.latestSettings.alignmentWindow
      }
    });

    const previous = node.worklet;
    if (previous) {
      node.input.disconnect(previous);
      disconnectNode(previous);
      const previousIndex = node.nodes.indexOf(previous);
      if (previousIndex >= 0) node.nodes.splice(previousIndex, 1);
    } else {
      node.input.disconnect(node.output);
    }

    node.worklet = worklet;
    node.pitchParam = worklet.parameters.get('pitch') ?? null;
    node.nodes.push(worklet);
    node.input.connect(worklet);
    worklet.connect(node.output);
  } catch (error) {
    if (worklet) disconnectNode(worklet);
    console.error('Raf could not construct the Pitch effect; using its dry path.', error);
  }
}

function ensurePitchWorklet(context: BaseAudioContext, url: string): Promise<boolean> {
  let byUrl = pitchWorkletLoads.get(context);
  if (!byUrl) {
    byUrl = new Map();
    pitchWorkletLoads.set(context, byUrl);
  }
  const cached = byUrl.get(url);
  if (cached) return cached;
  if (!('audioWorklet' in context) || typeof AudioWorkletNode === 'undefined') return Promise.resolve(false);

  const worklet = (context as AudioContext).audioWorklet;
  const load = worklet.addModule(url)
    .then(() => true)
    .catch((error) => {
      console.error('Raf could not load the Pitch worklet; using its dry path.', error);
      return false;
    });
  byUrl.set(url, load);
  return load;
}

function setParamInstant(parameter: AudioParam | null | undefined, value: number): void {
  if (!parameter) return;
  // Structural parameters are never ramped, so a direct set is safe.
  parameter.value = value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
