import type { RafPitchSettings } from '$lib/types';
import { disconnectNode, setAudioParam, type RafEffectNode } from './shared';

export const PITCH_SEMITONES_MIN = -12;
export const PITCH_SEMITONES_MAX = 12;

const PITCH_PROCESSOR_NAME = 'raf-pitch';
const PITCH_WORKLET_URL = '/raf-pitch.worklet.js';
const pitchWorkletLoads = new WeakMap<BaseAudioContext, Promise<boolean>>();

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
  node.ready = activatePitchProcessor(node, context);
  return node;
}

export function updatePitchNode(
  node: PitchNode,
  settings: RafPitchSettings,
  context: BaseAudioContext,
  previousSettings?: RafPitchSettings
): void {
  node.latestSettings = settings;
  if (previousSettings?.semitones === settings.semitones) return;
  if (node.pitchParam) setAudioParam(node.pitchParam, semitoneToFactor(settings.semitones), context);
}

export function disposePitchNode(node: PitchNode): void {
  node.disposed = true;
  node.nodes.forEach(disconnectNode);
}

async function activatePitchProcessor(node: PitchNode, context: BaseAudioContext): Promise<void> {
  if (!await ensurePitchWorklet(context) || node.disposed) return;

  let worklet: AudioWorkletNode | null = null;
  try {
    worklet = new AudioWorkletNode(context, PITCH_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      parameterData: { pitch: semitoneToFactor(node.latestSettings.semitones) }
    });
    node.worklet = worklet;
    node.pitchParam = worklet.parameters.get('pitch') ?? null;
    node.nodes.push(worklet);
    node.input.disconnect(node.output);
    node.input.connect(worklet);
    worklet.connect(node.output);
  } catch (error) {
    if (worklet) disconnectNode(worklet);
    console.error('Raf could not construct the Pitch effect; using its dry path.', error);
  }
}

function ensurePitchWorklet(context: BaseAudioContext): Promise<boolean> {
  const cached = pitchWorkletLoads.get(context);
  if (cached) return cached;
  if (!('audioWorklet' in context) || typeof AudioWorkletNode === 'undefined') return Promise.resolve(false);

  const worklet = (context as AudioContext).audioWorklet;
  const load = worklet.addModule(PITCH_WORKLET_URL)
    .then(() => true)
    .catch((error) => {
      console.error('Raf could not load the Pitch worklet; using its dry path.', error);
      return false;
    });
  pitchWorkletLoads.set(context, load);
  return load;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
