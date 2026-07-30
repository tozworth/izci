import { RAF_EFFECT_REGISTRY } from '$lib/services/raf-effect-registry';
import { clampAutoGain } from '$lib/services/raf-effects/auto-amp';
import type { RafAutoAmpSettings, RafEffectSettings } from '$lib/types';

function createBufferLike(source: AudioBuffer): AudioBuffer {
  return new AudioBuffer({
    length: Math.max(1, source.length),
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate
  });
}

export function peakDecibelsForBuffer(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

export function resolveOfflineAutoAmpGainDb(
  buffer: AudioBuffer,
  settings: RafAutoAmpSettings
): number {
  if (settings.mode === 'off') return settings.gainDb;
  const peakDb = peakDecibelsForBuffer(buffer);
  if (!Number.isFinite(peakDb)) return 0;
  return clampAutoGain(settings.targetDb - peakDb, settings);
}

function renderOfflineGain(buffer: AudioBuffer, gainDb: number): AudioBuffer {
  const output = createBufferLike(buffer);
  const gain = 10 ** (gainDb / 20);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const inputData = buffer.getChannelData(channel);
    const outputData = output.getChannelData(channel);
    for (let index = 0; index < inputData.length; index += 1) outputData[index] = inputData[index] * gain;
  }
  return output;
}

function copyForOfflineContext(context: OfflineAudioContext, source: AudioBuffer): AudioBuffer {
  const input = context.createBuffer(2, source.length, source.sampleRate);
  const left = source.getChannelData(0);
  input.copyToChannel(left, 0);
  input.copyToChannel(source.numberOfChannels > 1 ? source.getChannelData(1) : left, 1);
  return input;
}

function restoreChannelLayout(source: AudioBuffer, rendered: AudioBuffer): AudioBuffer {
  const output = createBufferLike(source);
  if (source.numberOfChannels === 1) {
    const mono = output.getChannelData(0);
    const left = rendered.getChannelData(0);
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
    for (let index = 0; index < mono.length; index += 1) mono[index] = (left[index] + right[index]) * 0.5;
    return output;
  }

  output.copyToChannel(rendered.getChannelData(0), 0);
  output.copyToChannel(rendered.getChannelData(Math.min(1, rendered.numberOfChannels - 1)), 1);
  for (let channel = 2; channel < source.numberOfChannels; channel += 1) {
    output.copyToChannel(source.getChannelData(channel), channel);
  }
  return output;
}

export async function renderRafEffect(
  source: AudioBuffer,
  settings: RafEffectSettings
): Promise<AudioBuffer> {
  if (settings.type === 'auto-amp') {
    return renderOfflineGain(source, resolveOfflineAutoAmpGainDb(source, settings));
  }
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('Offline audio processing is not available in this browser.');
  }

  const context = new OfflineAudioContext(2, Math.max(1, source.length), source.sampleRate);
  const input = context.createBufferSource();
  input.buffer = copyForOfflineContext(context, source);
  const definition = RAF_EFFECT_REGISTRY[settings.type];
  const effect = definition.createNode(context, settings);
  if ('ready' in effect && effect.ready instanceof Promise) await effect.ready;
  input.connect(effect.input);
  effect.output.connect(context.destination);
  input.start();
  try {
    const rendered = await context.startRendering();
    return restoreChannelLayout(source, rendered);
  } finally {
    definition.disposeNode(effect);
  }
}

export function blendRenderedEdges(
  original: AudioBuffer,
  processed: AudioBuffer,
  milliseconds: number,
  blendStart = true,
  blendEnd = true
): AudioBuffer {
  const frames = Math.min(
    Math.floor(Math.max(0, milliseconds) / 1_000 * original.sampleRate),
    Math.floor(original.length / 2)
  );
  if (frames === 0) return processed;

  for (let channel = 0; channel < processed.numberOfChannels; channel += 1) {
    const dry = original.getChannelData(Math.min(channel, original.numberOfChannels - 1));
    const wet = processed.getChannelData(channel);
    for (let index = 0; index < frames; index += 1) {
      const amount = (index + 1) / frames;
      if (blendStart) wet[index] = dry[index] * (1 - amount) + wet[index] * amount;
      if (blendEnd) {
        const endIndex = wet.length - 1 - index;
        wet[endIndex] = dry[endIndex] * (1 - amount) + wet[endIndex] * amount;
      }
    }
  }
  return processed;
}
