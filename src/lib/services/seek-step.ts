/** Pattern entries are chronological and belong only to the active subsong. */
export function resolveSeekStep(
  currentTime: number,
  direction: -1 | 1,
  duration: number,
  patternStartTimes: readonly number[] | null = null,
  stepSeconds = 5
): number {
  if (patternStartTimes?.length) {
    // Decoder clocks can land a fraction of a millisecond before a boundary.
    let current = 0;
    for (let index = 1; index < patternStartTimes.length; index++) {
      if (patternStartTimes[index] > currentTime + 0.001) break;
      current = index;
    }
    const next = Math.min(Math.max(current + direction, 0), patternStartTimes.length - 1);
    return Math.min(Math.max(patternStartTimes[next], 0), duration);
  }
  return Math.min(Math.max(currentTime + direction * stepSeconds, 0), duration);
}
