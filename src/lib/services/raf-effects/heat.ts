import type { RafHeatSettings } from '$lib/types';
import { decibelsToGain, disconnectNode, setAudioParam, type RafEffectNode } from './shared';

export const HEAT_DRIVE_MIN_DB = 0;
export const HEAT_DRIVE_MAX_DB = 24;
export const HEAT_OUTPUT_MIN_DB = -12;
export const HEAT_OUTPUT_MAX_DB = 12;
export const HEAT_COLOR_MIN_DB = -6;
export const HEAT_COLOR_MAX_DB = 6;
export const HEAT_ASYMMETRY_MIN = 0;
export const HEAT_ASYMMETRY_MAX = 100;
export const HEAT_CURVE_SIZE = 4097;
export const HEAT_TILT_FREQUENCY_HZ = 700;

export interface HeatNode extends RafEffectNode {
  drive: GainNode;
  colorLow: BiquadFilterNode;
  colorHigh: BiquadFilterNode;
  shaper: WaveShaperNode;
  makeup: GainNode;
  nodes: AudioNode[];
}

export function driveToGain(driveDb: number): number {
  return decibelsToGain(Math.min(HEAT_DRIVE_MAX_DB, Math.max(HEAT_DRIVE_MIN_DB, driveDb)));
}

export function outputToGain(outputDb: number): number {
  return decibelsToGain(Math.min(HEAT_OUTPUT_MAX_DB, Math.max(HEAT_OUTPUT_MIN_DB, outputDb)));
}

export function createHeatCurve(asymmetry: number): Float32Array<ArrayBuffer> {
  const amount = Math.min(HEAT_ASYMMETRY_MAX, Math.max(HEAT_ASYMMETRY_MIN, asymmetry)) / 100;
  const posAmount = 1 + amount * 0.8;
  const negAmount = 1 - amount * 0.3;
  const baseK = 2.2;
  const curve = new Float32Array(new ArrayBuffer(HEAT_CURVE_SIZE * Float32Array.BYTES_PER_ELEMENT));
  const posDen = Math.tanh(baseK * posAmount);
  const negDen = Math.tanh(baseK * negAmount);
  for (let index = 0; index < curve.length; index += 1) {
    const x = index / (curve.length - 1) * 2 - 1;
    if (x >= 0) {
      curve[index] = Math.tanh(x * baseK * posAmount) / posDen;
    } else {
      curve[index] = Math.tanh(x * baseK * negAmount) / negDen;
    }
  }
  return curve;
}

export function heatIsTransparent(settings: RafHeatSettings): boolean {
  return settings.driveDb === 0 && settings.outputDb === 0 && settings.colorDb === 0 && settings.asymmetry === 0;
}

export function createHeatNode(context: BaseAudioContext, settings: RafHeatSettings): HeatNode {
  const input = context.createGain();
  const drive = context.createGain();
  const colorLow = context.createBiquadFilter();
  const colorHigh = context.createBiquadFilter();
  const shaper = context.createWaveShaper();
  const makeup = context.createGain();
  const output = context.createGain();

  colorLow.type = 'lowshelf';
  colorLow.frequency.value = HEAT_TILT_FREQUENCY_HZ;
  colorLow.gain.value = -settings.colorDb / 2;
  colorHigh.type = 'highshelf';
  colorHigh.frequency.value = HEAT_TILT_FREQUENCY_HZ;
  colorHigh.gain.value = settings.colorDb / 2;

  drive.gain.value = driveToGain(settings.driveDb);
  makeup.gain.value = outputToGain(settings.outputDb);
  shaper.curve = createHeatCurve(settings.asymmetry);
  shaper.oversample = '2x';

  input.connect(drive).connect(colorLow).connect(colorHigh).connect(shaper).connect(makeup).connect(output);

  return { input, output, drive, colorLow, colorHigh, shaper, makeup, nodes: [input, drive, colorLow, colorHigh, shaper, makeup, output] };
}

export function updateHeatNode(
  node: HeatNode,
  settings: RafHeatSettings,
  context: BaseAudioContext,
  previousSettings?: RafHeatSettings
): void {
  if (!previousSettings || settings.driveDb !== previousSettings.driveDb) {
    setAudioParam(node.drive.gain, driveToGain(settings.driveDb), context);
  }
  if (!previousSettings || settings.outputDb !== previousSettings.outputDb) {
    setAudioParam(node.makeup.gain, outputToGain(settings.outputDb), context);
  }
  if (!previousSettings || settings.colorDb !== previousSettings.colorDb) {
    setAudioParam(node.colorLow.gain, -settings.colorDb / 2, context);
    setAudioParam(node.colorHigh.gain, settings.colorDb / 2, context);
  }
  if (!previousSettings || settings.asymmetry !== previousSettings.asymmetry) {
    node.shaper.curve = createHeatCurve(settings.asymmetry);
  }
}

export function disposeHeatNode(node: HeatNode): void {
  node.nodes.forEach(disconnectNode);
}
