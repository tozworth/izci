import type { RafGraphicEqSettings } from '$lib/types';
import { disconnectNode, setAudioParam, type RafEffectNode } from './shared';

export const GRAPHIC_EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const RAF_GAIN_MIN_DB = -24;
export const RAF_GAIN_MAX_DB = 24;
// Q = sqrt(2) gives an approximately one-octave useful width for these octave-spaced peaking bands.
export const GRAPHIC_EQ_Q = Math.SQRT2;

export interface GraphicEqNode extends RafEffectNode {
  preamp: GainNode;
  filters: BiquadFilterNode[];
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

  preamp.gain.value = 10 ** (settings.preampDb / 20);
  let previous: AudioNode = preamp;
  for (const filter of filters) {
    previous.connect(filter);
    previous = filter;
  }

  return { input: preamp, output: previous, preamp, filters };
}

export function updateGraphicEqNode(
  node: GraphicEqNode,
  settings: RafGraphicEqSettings,
  context: BaseAudioContext
): void {
  setAudioParam(node.preamp.gain, 10 ** (settings.preampDb / 20), context);
  node.filters.forEach((filter, index) => setAudioParam(filter.gain, settings.bandGainsDb[index], context));
}

export function disposeGraphicEqNode(node: GraphicEqNode): void {
  disconnectNode(node.preamp);
  node.filters.forEach(disconnectNode);
}
