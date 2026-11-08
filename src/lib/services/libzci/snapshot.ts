import type { PlaybackSnapshot } from '$lib/types';
import type { CoreSnapshot } from './protocol';

const FALLBACK_SAMPLE_RATE = 48_000;

export function coreTimeSeconds(frames: number, sampleRate: number | null | undefined): number {
  const rate = sampleRate && Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : FALLBACK_SAMPLE_RATE;
  return Number.isFinite(frames) ? Math.max(frames, 0) / rate : 0;
}

export function mapCoreState(state: CoreSnapshot['state']): PlaybackSnapshot['state'] {
  switch (state) {
    case 'Idle':
      return 'idle';
    case 'Loading':
      return 'loading';
    case 'Playing':
      return 'playing';
    case 'Ended':
      return 'ended';
    case 'Failed':
      return 'error';
    case 'Ready':
    case 'OutputSuspended':
    default:
      return 'paused';
  }
}

export function mapCoreSnapshot(core: CoreSnapshot): Pick<PlaybackSnapshot, 'state' | 'currentTime' | 'duration' | 'backend' | 'error'> {
  return {
    state: mapCoreState(core.state),
    currentTime: coreTimeSeconds(core.position_frames, core.sample_rate),
    duration: core.total_frames === null ? 0 : coreTimeSeconds(core.total_frames, core.sample_rate),
    backend: 'stream',
    error: core.error ?? undefined
  };
}
