export interface HivelyTimingCore {
  ahx_duration_frames(): number;
  ahx_decode_frame(): number;
  ahx_current_order(): number;
}

/** Probe a separate, low-rate decoder; never seek or render the live player. */
export function measureHivelyPatternStarts(core: HivelyTimingCore): number[] {
  const starts: number[] = [];
  let previousOrder = -1;
  const frames = core.ahx_duration_frames();
  for (let frame = 0; frame < frames; frame++) {
    if (!core.ahx_decode_frame()) break;
    // Hively reports the order belonging to the frame just decoded.
    const order = core.ahx_current_order();
    if (order !== previousOrder) {
      starts.push(frame / 50);
      previousOrder = order;
    }
  }
  return starts;
}
