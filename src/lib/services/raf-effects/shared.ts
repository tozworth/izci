export const RAF_PARAMETER_RAMP_SECONDS = 0.015;

export interface RafEffectNode {
  input: AudioNode;
  output: AudioNode;
}

export function decibelsToGain(decibels: number): number {
  return 10 ** (decibels / 20);
}

export function setAudioParam(
  parameter: AudioParam,
  value: number,
  context: BaseAudioContext,
  rampSeconds = RAF_PARAMETER_RAMP_SECONDS
): void {
  const now = context.currentTime;
  const currentValue = Number.isFinite(parameter.value) ? parameter.value : value;
  // Chromium can produce non-finite output when cancelAndHoldAtTime() is
  // repeatedly rescheduled at pointer-event frequency. Anchor the current
  // finite value explicitly before replacing the outstanding ramp instead.
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(currentValue, now);
  parameter.linearRampToValueAtTime(value, now + rampSeconds);
}

export function disconnectNode(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // A partially constructed or already disposed graph is safe to ignore.
  }
}
