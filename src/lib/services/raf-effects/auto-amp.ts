import { publishRafAutoAmpGain } from '$lib/services/raf-auto-amp-meter';
import type { RafAutoAmpMode, RafAutoAmpSettings } from '$lib/types';
import { decibelsToGain, disconnectNode, setAudioParam, type RafEffectNode } from './shared';

export const AUTO_AMP_GAIN_MIN_DB = -24;
export const AUTO_AMP_GAIN_MAX_DB = 24;
export const AUTO_AMP_TARGET_MIN_DB = -6;
export const AUTO_AMP_TARGET_MAX_DB = 0;
export const AUTO_AMP_REDUCTION_MAX_DB = 24;
export const AUTO_AMP_BOOST_MAX_DB = 24;
export const AUTO_AMP_PEAK_HOLD_MAX_SECONDS = 10;
export const AUTO_AMP_RECOVERY_MIN_DB_PER_SECOND = 0.25;
export const AUTO_AMP_RECOVERY_MAX_DB_PER_SECOND = 12;
export const AUTO_AMP_LOOKAHEAD_MIN_MS = 50;
export const AUTO_AMP_LOOKAHEAD_MAX_MS = 300;
const AUTO_AMP_ANALYSIS_INTERVAL_MS = 25;
const AUTO_AMP_SILENCE_DB = -54;
const AUTO_AMP_CUT_RAMP_SECONDS = 0.005;
const AUTO_AMP_PATH_CROSSFADE_SECONDS = 0.02;
const AUTO_AMP_LOOKAHEAD_SAFETY_MS = 40;

interface AutoAmpNode extends RafEffectNode {
  analyser: AnalyserNode;
  delay: DelayNode;
  directGain: GainNode;
  delayedGain: GainNode;
  gain: GainNode;
  controller: AutoAmpController;
  samples: Float32Array<ArrayBuffer>;
  timer: ReturnType<typeof setInterval> | null;
  settings: RafAutoAmpSettings;
  lastTickAt: number;
  scheduledGainDb: number;
}

export class AutoAmpController {
  #settings: RafAutoAmpSettings;
  #gainDb = 0;
  #heldPeakDb: number | null = null;
  #holdRemainingSeconds = 0;

  constructor(settings: RafAutoAmpSettings) {
    this.#settings = settings;
    this.#gainDb = settings.mode === 'off' ? settings.gainDb : 0;
  }

  get gainDb(): number {
    return this.#gainDb;
  }

  updateSettings(settings: RafAutoAmpSettings): number {
    const modeChanged = settings.mode !== this.#settings.mode;
    this.#settings = settings;
    if (settings.mode === 'off') {
      this.#gainDb = settings.gainDb;
      this.#resetPeak();
    } else if (modeChanged) {
      this.#gainDb = 0;
      this.#resetPeak();
    } else {
      this.#gainDb = clampAutoGain(this.#gainDb, settings);
    }
    return this.#gainDb;
  }

  processPeak(inputPeakDb: number, elapsedSeconds: number): number {
    const settings = this.#settings;
    if (settings.mode === 'off' || !Number.isFinite(inputPeakDb) || inputPeakDb < AUTO_AMP_SILENCE_DB) {
      return this.#gainDb;
    }

    const elapsed = Math.max(0, elapsedSeconds);
    if (this.#heldPeakDb === null || inputPeakDb >= this.#heldPeakDb) {
      this.#heldPeakDb = inputPeakDb;
      this.#holdRemainingSeconds = settings.peakHoldSeconds;
    } else {
      const heldSeconds = Math.min(this.#holdRemainingSeconds, elapsed);
      this.#holdRemainingSeconds -= heldSeconds;
      const recoverySeconds = elapsed - heldSeconds;
      if (recoverySeconds > 0) {
        this.#heldPeakDb = Math.max(
          inputPeakDb,
          this.#heldPeakDb - settings.recoveryDbPerSecond * recoverySeconds
        );
      }
    }

    const desiredGainDb = clampAutoGain(settings.targetDb - this.#heldPeakDb, settings);
    if (desiredGainDb <= this.#gainDb) {
      // Cuts happen immediately; only upward movement is deliberately slow.
      this.#gainDb = desiredGainDb;
    } else {
      this.#gainDb = Math.min(desiredGainDb, this.#gainDb + settings.recoveryDbPerSecond * elapsed);
    }
    return this.#gainDb;
  }

  #resetPeak(): void {
    this.#heldPeakDb = null;
    this.#holdRemainingSeconds = 0;
  }
}

export function createAutoAmpNode(context: BaseAudioContext, settings: RafAutoAmpSettings): AutoAmpNode {
  const analyser = context.createAnalyser();
  const delay = context.createDelay(AUTO_AMP_LOOKAHEAD_MAX_MS / 1000);
  const directGain = context.createGain();
  const delayedGain = context.createGain();
  const gain = context.createGain();
  const controller = new AutoAmpController(settings);
  const automatic = settings.mode !== 'off';
  analyser.fftSize = 4096;
  delay.delayTime.value = settings.lookaheadMs / 1000;
  directGain.gain.value = automatic ? 0 : 1;
  delayedGain.gain.value = automatic ? 1 : 0;
  analyser.connect(directGain).connect(gain);
  analyser.connect(delay).connect(delayedGain).connect(gain);
  gain.gain.value = decibelsToGain(controller.gainDb);

  const node: AutoAmpNode = {
    input: analyser,
    output: gain,
    analyser,
    delay,
    directGain,
    delayedGain,
    gain,
    controller,
    samples: new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT)),
    settings,
    timer: null,
    lastTickAt: Date.now(),
    scheduledGainDb: controller.gainDb
  };
  if (settings.mode !== 'off') startAutoAmpAnalysis(node, context);
  publishRafAutoAmpGain(settings.id, controller.gainDb);
  return node;
}

export function updateAutoAmpNode(
  node: AutoAmpNode,
  settings: RafAutoAmpSettings,
  context: BaseAudioContext,
  previousSettings?: RafAutoAmpSettings
): void {
  const previousGainDb = node.controller.gainDb;
  const modeChanged = !previousSettings || settings.mode !== previousSettings.mode;
  const lookaheadChanged = !previousSettings || settings.lookaheadMs !== previousSettings.lookaheadMs;
  node.settings = settings;
  node.lastTickAt = Date.now();
  const gainDb = node.controller.updateSettings(settings);
  if (lookaheadChanged) {
    setAudioParam(node.delay.delayTime, settings.lookaheadMs / 1000, context, 0.05);
  }
  if (modeChanged) {
    const automatic = settings.mode !== 'off';
    setAudioParam(node.directGain.gain, automatic ? 0 : 1, context, AUTO_AMP_PATH_CROSSFADE_SECONDS);
    setAudioParam(node.delayedGain.gain, automatic ? 1 : 0, context, AUTO_AMP_PATH_CROSSFADE_SECONDS);
  }
  if (settings.mode === 'off') stopAutoAmpAnalysis(node);
  else startAutoAmpAnalysis(node, context);
  if (!previousSettings || gainDb !== previousGainDb || modeChanged || lookaheadChanged) {
    setAudioParam(node.gain.gain, decibelsToGain(gainDb), context);
    node.scheduledGainDb = gainDb;
  }
  publishRafAutoAmpGain(settings.id, gainDb);
}

export function disposeAutoAmpNode(node: AutoAmpNode): void {
  stopAutoAmpAnalysis(node);
  publishRafAutoAmpGain(node.settings.id, null);
  disconnectNode(node.analyser);
  disconnectNode(node.delay);
  disconnectNode(node.directGain);
  disconnectNode(node.delayedGain);
  disconnectNode(node.gain);
}

export function clampAutoGain(gainDb: number, settings: Pick<RafAutoAmpSettings, 'mode' | 'maximumReductionDb' | 'maximumBoostDb'>): number {
  const minimum = settings.mode === 'increase' ? 0 : -settings.maximumReductionDb;
  const maximum = settings.mode === 'reduce' ? 0 : settings.maximumBoostDb;
  return Math.min(maximum, Math.max(minimum, gainDb));
}

export function peakDecibels(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

function analyzeAutoAmp(node: AutoAmpNode, context: BaseAudioContext): void {
  if (node.settings.mode === 'off') return;
  node.analyser.getFloatTimeDomainData(node.samples);
  const now = Date.now();
  const elapsedSeconds = Math.min(1, Math.max(0, (now - node.lastTickAt) / 1000));
  node.lastTickAt = now;
  const previousGainDb = node.controller.gainDb;
  const gainDb = node.controller.processPeak(peakDecibels(node.samples), elapsedSeconds);
  if (gainDb !== previousGainDb) {
    scheduleAutoAmpGain(node, gainDb, context);
  }
  publishRafAutoAmpGain(node.settings.id, gainDb);
}

function scheduleAutoAmpGain(node: AutoAmpNode, gainDb: number, context: BaseAudioContext): void {
  const leadSeconds = Math.max(
    0,
    (node.settings.lookaheadMs - AUTO_AMP_LOOKAHEAD_SAFETY_MS) / 1000
  );
  const applyAt = context.currentTime + leadSeconds;
  const parameter = node.gain.gain;
  if (gainDb < node.scheduledGainDb) {
    const rampStart = Math.max(context.currentTime, applyAt - AUTO_AMP_CUT_RAMP_SECONDS);
    parameter.setValueAtTime(decibelsToGain(node.scheduledGainDb), rampStart);
  }
  parameter.linearRampToValueAtTime(decibelsToGain(gainDb), applyAt);
  node.scheduledGainDb = gainDb;
}

function startAutoAmpAnalysis(node: AutoAmpNode, context: BaseAudioContext): void {
  if (node.timer !== null) return;
  node.lastTickAt = Date.now();
  node.timer = setInterval(() => analyzeAutoAmp(node, context), AUTO_AMP_ANALYSIS_INTERVAL_MS);
}

function stopAutoAmpAnalysis(node: AutoAmpNode): void {
  if (node.timer === null) return;
  clearInterval(node.timer);
  node.timer = null;
}

export function isAutoAmpMode(value: unknown): value is RafAutoAmpMode {
  return value === 'off' || value === 'reduce' || value === 'increase' || value === 'dynamic';
}
