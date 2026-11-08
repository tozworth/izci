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

export function mapCoreSnapshot(
  core: CoreSnapshot,
  kind: 'stream' | 'module' = 'stream'
): Pick<PlaybackSnapshot, 'state' | 'currentTime' | 'duration' | 'backend' | 'error' | 'subsong' | 'subsongCount'> {
  const providerId = core.provider?.id ?? '';
  const backend = kind === 'module' || providerId === 'org.openmpt.libopenmpt' || providerId === 'hivelytracker.replay'
    ? 'module'
    : 'stream';
  const subsongCount = typeof core.capabilities?.['subsongs'] === 'number'
    ? Math.max(1, Math.trunc(core.capabilities['subsongs'] as number))
    : undefined;
  const subsong = typeof core.subsong === 'number' && Number.isFinite(core.subsong)
    ? Math.max(0, Math.trunc(core.subsong))
    : undefined;
  return {
    state: mapCoreState(core.state),
    currentTime: coreTimeSeconds(core.position_frames, core.sample_rate),
    duration: core.total_frames === null ? 0 : coreTimeSeconds(core.total_frames, core.sample_rate),
    backend,
    error: core.error ?? undefined,
    ...(subsong !== undefined ? { subsong } : {}),
    ...(subsongCount !== undefined && backend === 'module' ? { subsongCount } : {})
  };
}

export function mapModulePosition(core: CoreSnapshot): { order: number; pattern: number; row: number } | null {
  if (!core.module) return null;
  return {
    order: Math.max(0, Math.trunc(core.module.order)),
    pattern: Math.max(0, Math.trunc(core.module.pattern)),
    row: Math.max(0, Math.trunc(core.module.row))
  };
}
