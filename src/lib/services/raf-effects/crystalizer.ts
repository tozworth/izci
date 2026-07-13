import type { RafCrystalizerSettings } from '$lib/types';
import { disconnectNode, setAudioParam, type RafEffectNode } from './shared';

export const CRYSTALIZER_BAND_EDGES = Array.from({ length: 14 }, (_, index) =>
  20 * 1000 ** ((index / 13) ** 0.413)
);
export const CRYSTALIZER_FREQUENCIES = CRYSTALIZER_BAND_EDGES.slice(0, -1).map((low, index) =>
  Math.round((low + CRYSTALIZER_BAND_EDGES[index + 1]) / 2)
);
export const CRYSTALIZER_INTENSITY_MIN = -40;
export const CRYSTALIZER_INTENSITY_MAX = 32;

const HEADROOM_SAMPLE_COUNT = 1024;
const HEADROOM_MIN_FREQUENCY = 20;
const HEADROOM_MAX_FREQUENCY = 20_000;
const HEADROOM_SAFETY_DB = 1;

interface CrystalizerBandNode {
  filter: BiquadFilterNode;
  derivative: IIRFilterNode;
  muteDelay: DelayNode;
  intensity: GainNode;
  mute: GainNode;
}

export interface CrystalizerNode extends RafEffectNode {
  input: GainNode;
  dryDelay: DelayNode;
  sum: GainNode;
  headroom: GainNode;
  bands: CrystalizerBandNode[];
  nodes: AudioNode[];
}

export function intensityToFactor(intensity: number): number {
  return intensity / Math.abs(CRYSTALIZER_INTENSITY_MIN);
}

export function createCrystalizerNode(
  context: BaseAudioContext,
  settings: RafCrystalizerSettings
): CrystalizerNode {
  const input = context.createGain();
  const dryDelay = context.createDelay(1);
  const sum = context.createGain();
  const headroom = context.createGain();
  dryDelay.delayTime.value = 1 / context.sampleRate;
  const bands = CRYSTALIZER_FREQUENCIES.map((frequency, index) => {
    const low = CRYSTALIZER_BAND_EDGES[index];
    const high = CRYSTALIZER_BAND_EDGES[index + 1];
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = Math.min(frequency, context.sampleRate * 0.45);
    filter.Q.value = frequency / (high - low);

    // (1 - z^-1)^2 is a causal second difference. Subtracting it from a band
    // sharpens its local peaks in the same spirit as EasyEffects' crystalizer.
    const derivative = context.createIIRFilter([1, -2, 1], [1]);
    const muteDelay = context.createDelay(1);
    const intensity = context.createGain();
    const mute = context.createGain();
    muteDelay.delayTime.value = 1 / context.sampleRate;
    intensity.gain.value = bandIntensityGain(settings, index);
    mute.gain.value = settings.bandMuted[index] ? -1 : 0;

    input.connect(filter);
    filter.connect(derivative);
    derivative.connect(intensity);
    intensity.connect(sum);
    filter.connect(muteDelay);
    muteDelay.connect(mute);
    mute.connect(sum);
    return { filter, derivative, muteDelay, intensity, mute };
  });

  input.connect(dryDelay);
  dryDelay.connect(sum);
  sum.connect(headroom);
  headroom.gain.value = calculateCrystalizerHeadroomGain(bands.map((band) => band.filter), settings, context.sampleRate);

  return {
    input,
    output: headroom,
    dryDelay,
    sum,
    headroom,
    bands,
    nodes: [
      input,
      dryDelay,
      sum,
      headroom,
      ...bands.flatMap((band) => [band.filter, band.derivative, band.muteDelay, band.intensity, band.mute])
    ]
  };
}

export function updateCrystalizerNode(
  node: CrystalizerNode,
  settings: RafCrystalizerSettings,
  context: BaseAudioContext
): void {
  node.bands.forEach((band, index) => {
    setAudioParam(band.intensity.gain, bandIntensityGain(settings, index), context);
    setAudioParam(band.mute.gain, settings.bandMuted[index] ? -1 : 0, context);
  });
  setAudioParam(
    node.headroom.gain,
    calculateCrystalizerHeadroomGain(node.bands.map((band) => band.filter), settings, context.sampleRate),
    context
  );
}

export function disposeCrystalizerNode(node: CrystalizerNode): void {
  node.nodes.forEach(disconnectNode);
}

export function calculateCrystalizerHeadroomGain(
  filters: BiquadFilterNode[],
  settings: RafCrystalizerSettings,
  sampleRate: number
): number {
  const frequencies = new Float32Array(HEADROOM_SAMPLE_COUNT);
  const magnitudes = new Float32Array(HEADROOM_SAMPLE_COUNT);
  const phases = new Float32Array(HEADROOM_SAMPLE_COUNT);
  const real = new Float64Array(HEADROOM_SAMPLE_COUNT);
  const imaginary = new Float64Array(HEADROOM_SAMPLE_COUNT);
  const maximumFrequency = Math.min(HEADROOM_MAX_FREQUENCY, sampleRate * 0.45);
  const ratio = maximumFrequency / HEADROOM_MIN_FREQUENCY;

  for (let index = 0; index < frequencies.length; index += 1) {
    frequencies[index] = HEADROOM_MIN_FREQUENCY * ratio ** (index / (frequencies.length - 1));
    const omega = 2 * Math.PI * frequencies[index] / sampleRate;
    real[index] = Math.cos(omega);
    imaginary[index] = -Math.sin(omega);
  }

  filters.forEach((filter, bandIndex) => {
    const muted = settings.bandMuted[bandIndex];
    const factor = bandIntensityGain(settings, bandIndex);
    if (!muted && factor === 0) return;
    filter.getFrequencyResponse(frequencies, magnitudes, phases);

    for (let index = 0; index < frequencies.length; index += 1) {
      const filterReal = magnitudes[index] * Math.cos(phases[index]);
      const filterImaginary = magnitudes[index] * Math.sin(phases[index]);
      const omega = 2 * Math.PI * frequencies[index] / sampleRate;
      if (muted) {
        const delayReal = Math.cos(omega);
        const delayImaginary = -Math.sin(omega);
        real[index] -= filterReal * delayReal - filterImaginary * delayImaginary;
        imaginary[index] -= filterReal * delayImaginary + filterImaginary * delayReal;
        continue;
      }

      const differenceReal = 1 - Math.cos(omega);
      const differenceImaginary = Math.sin(omega);
      const derivativeReal = differenceReal ** 2 - differenceImaginary ** 2;
      const derivativeImaginary = 2 * differenceReal * differenceImaginary;
      real[index] -= factor * (filterReal * derivativeReal - filterImaginary * derivativeImaginary);
      imaginary[index] -= factor * (filterReal * derivativeImaginary + filterImaginary * derivativeReal);
    }
  });

  let peak = 1;
  for (let index = 0; index < real.length; index += 1) {
    peak = Math.max(peak, Math.hypot(real[index], imaginary[index]));
  }
  return peak > 1 + 1e-6 ? 10 ** (-HEADROOM_SAFETY_DB / 20) / peak : 1;
}

function bandIntensityGain(settings: RafCrystalizerSettings, index: number): number {
  return settings.bandMuted[index] || settings.bandBypassed[index]
    ? 0
    : intensityToFactor(settings.bandIntensities[index]);
}
