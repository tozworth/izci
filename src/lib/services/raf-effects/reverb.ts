import type { RafReverbSettings } from '$lib/types';
import { disconnectNode, setAudioParam, type RafEffectNode } from './shared';

export const REVERB_MIX_MIN = 0;
export const REVERB_MIX_MAX = 100;
export const REVERB_ROOM_SIZE_MIN = 0;
export const REVERB_ROOM_SIZE_MAX = 100;
export const REVERB_DECAY_MIN_SECONDS = 0.4;
export const REVERB_DECAY_MAX_SECONDS = 8;
export const REVERB_PRE_DELAY_MIN_MS = 0;
export const REVERB_PRE_DELAY_MAX_MS = 120;
export const REVERB_DAMPING_MIN_HZ = 1_000;
export const REVERB_DAMPING_MAX_HZ = 20_000;
const IMPULSE_CROSSFADE_SECONDS = 0.08;

interface ReverbSlot {
  convolver: ConvolverNode;
  damping: BiquadFilterNode;
  gain: GainNode;
}

export interface ReverbNode extends RafEffectNode {
  dry: GainNode;
  wet: GainNode;
  preDelay: DelayNode;
  slots: [ReverbSlot, ReverbSlot];
  activeSlot: 0 | 1;
}

export function createReverbNode(context: BaseAudioContext, settings: RafReverbSettings): ReverbNode {
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const preDelay = context.createDelay(REVERB_PRE_DELAY_MAX_MS / 1_000);
  const impulse = createRoomImpulse(context, settings.roomSize, settings.decaySeconds);
  const slots: [ReverbSlot, ReverbSlot] = [createSlot(context, impulse), createSlot(context, impulse)];

  input.connect(dry).connect(output);
  input.connect(preDelay);
  for (const slot of slots) {
    preDelay.connect(slot.convolver).connect(slot.damping).connect(slot.gain).connect(wet);
    slot.damping.frequency.value = settings.dampingHz;
  }
  wet.connect(output);
  slots[0].gain.gain.value = 1;
  slots[1].gain.gain.value = 0;
  preDelay.delayTime.value = settings.preDelayMs / 1_000;
  applyMix(dry, wet, settings.mix);

  return { input, output, dry, wet, preDelay, slots, activeSlot: 0 };
}

export function updateReverbNode(
  node: ReverbNode,
  settings: RafReverbSettings,
  context: BaseAudioContext,
  previousSettings?: RafReverbSettings
): void {
  if (!previousSettings || settings.mix !== previousSettings.mix) {
    const gains = reverbMixToGains(settings.mix);
    setAudioParam(node.dry.gain, gains.dry, context);
    setAudioParam(node.wet.gain, gains.wet, context);
  }
  if (!previousSettings || settings.preDelayMs !== previousSettings.preDelayMs) {
    setAudioParam(node.preDelay.delayTime, settings.preDelayMs / 1_000, context);
  }
  if (!previousSettings || settings.dampingHz !== previousSettings.dampingHz) {
    for (const slot of node.slots) setAudioParam(slot.damping.frequency, settings.dampingHz, context);
  }
  if (
    !previousSettings
    || settings.roomSize !== previousSettings.roomSize
    || settings.decaySeconds !== previousSettings.decaySeconds
  ) {
    const nextIndex: 0 | 1 = node.activeSlot === 0 ? 1 : 0;
    const current = node.slots[node.activeSlot];
    const next = node.slots[nextIndex];
    next.convolver.buffer = createRoomImpulse(context, settings.roomSize, settings.decaySeconds);
    setAudioParam(next.gain.gain, 1, context, IMPULSE_CROSSFADE_SECONDS);
    setAudioParam(current.gain.gain, 0, context, IMPULSE_CROSSFADE_SECONDS);
    node.activeSlot = nextIndex;
  }
}

export function disposeReverbNode(node: ReverbNode): void {
  disconnectNode(node.input);
  disconnectNode(node.dry);
  disconnectNode(node.preDelay);
  for (const slot of node.slots) {
    disconnectNode(slot.convolver);
    disconnectNode(slot.damping);
    disconnectNode(slot.gain);
    slot.convolver.buffer = null;
  }
  disconnectNode(node.wet);
  disconnectNode(node.output);
}

export function reverbMixToGains(mix: number): { dry: number; wet: number } {
  const position = Math.min(1, Math.max(0, mix / 100)) * Math.PI / 2;
  return { dry: Math.cos(position), wet: Math.sin(position) };
}

export function createRoomImpulse(
  context: BaseAudioContext,
  roomSize: number,
  decaySeconds: number
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.ceil(decaySeconds * sampleRate));
  const buffer = context.createBuffer(2, length, sampleRate);
  const room = Math.min(1, Math.max(0, roomSize / 100));
  const lateStart = 0.012 + room * 0.045;
  const reflectionTimes = [0.006, 0.011, 0.019, 0.031, 0.047, 0.071];

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    const random = seededRandom(0x49a7f21d ^ (channel * 0x6d2b79f5) ^ Math.round(roomSize * 997));
    for (let index = Math.floor(lateStart * sampleRate); index < length; index += 1) {
      const time = index / sampleRate;
      const bloom = Math.min(1, (time - lateStart) / (0.035 + room * 0.055));
      const envelope = Math.exp(-6.907755 * time / decaySeconds);
      data[index] = (random() * 2 - 1) * bloom * envelope;
    }
    reflectionTimes.forEach((baseTime, reflectionIndex) => {
      const spread = baseTime * (0.72 + room * 1.65);
      const stereoOffset = channel === 0 ? 0 : (reflectionIndex % 2 === 0 ? 0.0017 : -0.0011);
      const sample = Math.round((spread + stereoOffset) * sampleRate);
      if (sample >= 0 && sample < length) {
        data[sample] += (reflectionIndex % 2 === 0 ? 1 : -1) * (0.78 / (reflectionIndex + 1));
      }
    });
  }
  return buffer;
}

function createSlot(context: BaseAudioContext, impulse: AudioBuffer): ReverbSlot {
  const convolver = context.createConvolver();
  const damping = context.createBiquadFilter();
  const gain = context.createGain();
  convolver.normalize = true;
  convolver.buffer = impulse;
  damping.type = 'lowpass';
  damping.Q.value = 0.5;
  return { convolver, damping, gain };
}

function applyMix(dry: GainNode, wet: GainNode, mix: number): void {
  const gains = reverbMixToGains(mix);
  dry.gain.value = gains.dry;
  wet.gain.value = gains.wet;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}
