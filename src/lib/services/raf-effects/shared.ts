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
  if (typeof parameter.cancelAndHoldAtTime === 'function') {
    parameter.cancelAndHoldAtTime(now);
  } else {
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(parameter.value, now);
  }
  parameter.linearRampToValueAtTime(value, now + rampSeconds);
}

export function disconnectNode(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // A partially constructed or already disposed graph is safe to ignore.
  }
}
