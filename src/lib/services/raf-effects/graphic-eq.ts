import type { RafGraphicEqSettings } from '$lib/types';
import { disconnectNode, setAudioParam, type RafEffectNode } from './shared';

export const GRAPHIC_EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const RAF_GAIN_MIN_DB = -12;
export const RAF_GAIN_MAX_DB = 12;
const HEADROOM_SAMPLE_COUNT = 1024;
const HEADROOM_MIN_FREQUENCY = 20;
const HEADROOM_MAX_FREQUENCY = 20_000;
const HEADROOM_SAFETY_DB = 1;
// Q = sqrt(2) gives an approximately one-octave useful width for these octave-spaced peaking bands.
export const GRAPHIC_EQ_Q = Math.SQRT2;

export interface GraphicEqNode extends RafEffectNode {
  preamp: GainNode;
  filters: BiquadFilterNode[];
  headroom: GainNode;
  responseProbe: BiquadFilterNode;
}

export function createGraphicEqNode(
  context: BaseAudioContext,
  settings: RafGraphicEqSettings
): GraphicEqNode {
  const preamp = context.createGain();
  const filters = GRAPHIC_EQ_FREQUENCIES.map((frequency, index) => {
    const filter = context.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = GRAPHIC_EQ_Q;
    filter.gain.value = settings.bandGainsDb[index];
    return filter;
  });
  const headroom = context.createGain();
  const responseProbe = context.createBiquadFilter();
  responseProbe.type = 'peaking';
  responseProbe.Q.value = GRAPHIC_EQ_Q;

  preamp.gain.value = 10 ** (settings.preampDb / 20);
  let previous: AudioNode = preamp;
  for (const filter of filters) {
    previous.connect(filter);
    previous = filter;
  }
  previous.connect(headroom);
  headroom.gain.value = calculateHeadroomGain(responseProbe, settings);

  return { input: preamp, output: headroom, preamp, filters, headroom, responseProbe };
}

export function updateGraphicEqNode(
  node: GraphicEqNode,
  settings: RafGraphicEqSettings,
  context: BaseAudioContext
): void {
  setAudioParam(node.preamp.gain, 10 ** (settings.preampDb / 20), context);
  node.filters.forEach((filter, index) => setAudioParam(filter.gain, settings.bandGainsDb[index], context));
  setAudioParam(node.headroom.gain, calculateHeadroomGain(node.responseProbe, settings), context);
}

export function disposeGraphicEqNode(node: GraphicEqNode): void {
  disconnectNode(node.preamp);
  node.filters.forEach(disconnectNode);
  disconnectNode(node.headroom);
  disconnectNode(node.responseProbe);
}

export function calculateHeadroomGain(
  probe: BiquadFilterNode,
  settings: RafGraphicEqSettings
): number {
  const frequencies = new Float32Array(HEADROOM_SAMPLE_COUNT);
  const magnitudes = new Float32Array(HEADROOM_SAMPLE_COUNT);
  const phases = new Float32Array(HEADROOM_SAMPLE_COUNT);
  const combinedDb = new Float64Array(HEADROOM_SAMPLE_COUNT);
  const ratio = HEADROOM_MAX_FREQUENCY / HEADROOM_MIN_FREQUENCY;

  for (let index = 0; index < frequencies.length; index += 1) {
    frequencies[index] = HEADROOM_MIN_FREQUENCY * ratio ** (index / (frequencies.length - 1));
  }

  GRAPHIC_EQ_FREQUENCIES.forEach((frequency, bandIndex) => {
    probe.frequency.value = frequency;
    probe.gain.value = settings.bandGainsDb[bandIndex];
    probe.getFrequencyResponse(frequencies, magnitudes, phases);
    for (let index = 0; index < magnitudes.length; index += 1) {
      combinedDb[index] += 20 * Math.log10(Math.max(magnitudes[index], Number.EPSILON));
    }
  });

  const peakDb = settings.preampDb + Math.max(...combinedDb);
  return peakDb > 0 ? 10 ** (-(peakDb + HEADROOM_SAFETY_DB) / 20) : 1;
}
