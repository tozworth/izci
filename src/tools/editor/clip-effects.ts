import { RAF_EFFECT_REGISTRY } from '$lib/services/raf-effect-registry';
import { clampAutoGain } from '$lib/services/raf-effects/auto-amp';
import type { RafAutoAmpSettings, RafEffectSettings } from '$lib/types';
import { yieldEditorTask } from './editor-task';

export type ClipSpeedMode = 'speed' | 'pitch' | 'tempo';

interface ClipSpeedEffectSettings {
  type: 'speed';
  displayName: 'Speed';
  mode: ClipSpeedMode;
  factor: number;
}

export type ClipEffectSettings = RafEffectSettings | ClipSpeedEffectSettings;

export const SPEED_EFFECT = {
  type: 'speed' as const,
  name: 'Speed',
  icon: 'speed'
};

export function isClipSpeedEffect(settings: ClipEffectSettings): settings is ClipSpeedEffectSettings {
  return settings.type === 'speed';
}

export function createSpeedEffectSettings(): ClipSpeedEffectSettings {
  return { type: 'speed', displayName: 'Speed', mode: 'speed', factor: 1 };
}

function createBufferLike(source: AudioBuffer): AudioBuffer {
  return new AudioBuffer({
    length: Math.max(1, source.length),
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate
  });
}

async function forFrames(length: number, process: (start: number, end: number) => void, signal?: AbortSignal): Promise<void> {
  let deadline = performance.now() + 4;
  for (let start = 0; start < length; start += 16_384) {
    signal?.throwIfAborted();
    process(start, Math.min(length, start + 16_384));
    if (performance.now() >= deadline) {
      await yieldEditorTask(signal);
      deadline = performance.now() + 4;
    }
  }
}

async function resolveOfflineAutoAmpGainDb(buffer: AudioBuffer, settings: RafAutoAmpSettings, signal?: AbortSignal): Promise<number> {
  if (settings.mode === 'off') return settings.gainDb;
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    await forFrames(samples.length, (start, end) => {
      for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
    }, signal);
  }
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  return Number.isFinite(peakDb) ? clampAutoGain(settings.targetDb - peakDb, settings) : 0;
}

async function renderOfflineGain(buffer: AudioBuffer, gainDb: number, signal?: AbortSignal): Promise<AudioBuffer> {
  const output = createBufferLike(buffer);
  const gain = 10 ** (gainDb / 20);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    await forFrames(input.length, (start, end) => {
      for (let index = start; index < end; index += 1) target[index] = input[index] * gain;
    }, signal);
  }
  return output;
}

async function copyForOfflineContext(context: OfflineAudioContext, source: AudioBuffer, signal?: AbortSignal): Promise<AudioBuffer> {
  const input = context.createBuffer(2, source.length, source.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const samples = source.getChannelData(Math.min(channel, source.numberOfChannels - 1));
    const target = input.getChannelData(channel);
    await forFrames(source.length, (start, end) => target.set(samples.subarray(start, end), start), signal);
  }
  return input;
}

async function restoreChannelLayout(source: AudioBuffer, rendered: AudioBuffer, signal?: AbortSignal): Promise<AudioBuffer> {
  const output = createBufferLike(source);
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const target = output.getChannelData(channel);
    const input = channel < 2 ? rendered.getChannelData(channel) : source.getChannelData(channel);
    if (source.numberOfChannels === 1) {
      const right = rendered.getChannelData(Math.min(1, rendered.numberOfChannels - 1));
      await forFrames(target.length, (start, end) => {
        for (let index = start; index < end; index += 1) target[index] = (input[index] + right[index]) * 0.5;
      }, signal);
    } else await forFrames(target.length, (start, end) => target.set(input.subarray(start, end), start), signal);
  }
  return output;
}

async function renderRafEffect(
  source: AudioBuffer,
  settings: RafEffectSettings,
  signal?: AbortSignal
): Promise<AudioBuffer> {
  if (settings.type === 'auto-amp') {
    return renderOfflineGain(source, await resolveOfflineAutoAmpGainDb(source, settings, signal), signal);
  }
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('Offline audio processing is not available in this browser.');
  }

  const context = new OfflineAudioContext(2, Math.max(1, source.length), source.sampleRate);
  const input = context.createBufferSource();
  input.buffer = await copyForOfflineContext(context, source, signal);
  const definition = RAF_EFFECT_REGISTRY[settings.type];
  const effect = definition.createNode(context, settings);
  try {
    if ('ready' in effect && effect.ready instanceof Promise) await effect.ready;
    signal?.throwIfAborted();
    input.connect(effect.input);
    effect.output.connect(context.destination);
    input.start();
    const rendered = await context.startRendering();
    signal?.throwIfAborted();
    return await restoreChannelLayout(source, rendered, signal);
  } finally {
    definition.disposeNode(effect);
  }
}

function clampSpeedFactor(value: number): number {
  return Number.isFinite(value) ? Math.min(4, Math.max(0.25, value)) : 1;
}

async function resampleBuffer(source: AudioBuffer, factor: number, signal?: AbortSignal): Promise<AudioBuffer> {
  const output = new AudioBuffer({
    length: Math.max(1, Math.round(source.length / factor)),
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate
  });
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const input = source.getChannelData(channel);
    const samples = output.getChannelData(channel);
    await forFrames(samples.length, (start, end) => {
      for (let index = start; index < end; index += 1) {
        const position = index * factor;
        const lower = Math.min(input.length - 1, Math.floor(position));
        const upper = Math.min(input.length - 1, lower + 1);
        samples[index] = input[lower] * (1 - (position - lower)) + input[upper] * (position - lower);
      }
    }, signal);
  }
  return output;
}

/** A compact overlap-add stretcher for destructive editor operations. */
async function timeStretchBuffer(source: AudioBuffer, speed: number, signal?: AbortSignal): Promise<AudioBuffer> {
  const grainSize = Math.min(2_048, Math.max(256, 2 ** Math.floor(Math.log2(Math.max(256, source.sampleRate / 20)))));
  const synthesisHop = Math.floor(grainSize / 4);
  const analysisHop = synthesisHop * speed;
  const outputLength = Math.max(1, Math.round(source.length / speed));
  const output = new AudioBuffer({ length: outputLength, numberOfChannels: source.numberOfChannels, sampleRate: source.sampleRate });
  const weights = new Float32Array(outputLength);
  const window = new Float32Array(grainSize);
  for (let index = 0; index < grainSize; index += 1) window[index] = Math.sin(Math.PI * (index + 0.5) / grainSize);

  const inputs = Array.from({ length: source.numberOfChannels }, (_, channel) => source.getChannelData(channel));
  const outputs = Array.from({ length: output.numberOfChannels }, (_, channel) => output.getChannelData(channel));
  let deadline = performance.now() + 4;
  for (let outputStart = 0, grain = 0; outputStart < outputLength; outputStart += synthesisHop, grain += 1) {
    if ((grain & 15) === 0) {
      signal?.throwIfAborted();
      if (performance.now() >= deadline) { await yieldEditorTask(signal); deadline = performance.now() + 4; }
    }
    const inputStart = Math.min(source.length - 1, Math.round(grain * analysisHop));
    for (let index = 0; index < grainSize && outputStart + index < outputLength; index += 1) {
      // Extend the final sample through a partial grain, so stretched/pitched
      // tails retain coverage instead of introducing unwritten zero frames.
      const sourceIndex = Math.min(source.length - 1, inputStart + index);
      const weight = window[index];
      weights[outputStart + index] += weight;
      for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
        outputs[channel][outputStart + index] += inputs[channel][sourceIndex] * weight;
      }
    }
  }
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const samples = output.getChannelData(channel);
    await forFrames(samples.length, (start, end) => {
      for (let index = start; index < end; index += 1) if (weights[index] > 0) samples[index] /= weights[index];
    }, signal);
  }
  return output;
}

export async function renderClipEffect(source: AudioBuffer, settings: ClipEffectSettings, signal?: AbortSignal): Promise<AudioBuffer> {
  // Let busy/status changes paint before allocating or processing selection PCM.
  await yieldEditorTask(signal);
  if (!isClipSpeedEffect(settings)) return renderRafEffect(source, settings, signal);
  const factor = clampSpeedFactor(settings.factor);
  if (factor === 1) return renderOfflineGain(source, 0, signal);
  if (settings.mode === 'speed') return resampleBuffer(source, factor, signal);
  if (settings.mode === 'tempo') return timeStretchBuffer(source, factor, signal);
  return timeStretchBuffer(await resampleBuffer(source, factor, signal), 1 / factor, signal);
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
