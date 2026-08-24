import type { ReplayGainMetadata, TrackMetadata } from '$lib/types';

function normalizeReplayGainDb(value: string): number | undefined {
  const parsed = parseDecimalTagValue(value);
  return parsed !== undefined && parsed >= -60 && parsed <= 60 ? parsed : undefined;
}

function normalizeReplayGainPeak(value: string): number | undefined {
  const parsed = parseDecimalTagValue(value);
  return parsed !== undefined && parsed > 0 && parsed <= 100 ? parsed : undefined;
}

function normalizeR128GainDb(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  const gainDb = Number.isFinite(parsed) ? parsed / 256 : undefined;

  return gainDb !== undefined && gainDb >= -60 && gainDb <= 60 ? gainDb : undefined;
}

function ensureReplayGain(metadata: TrackMetadata): ReplayGainMetadata {
  metadata.replayGain ??= {};
  return metadata.replayGain;
}

function assignReplayGainValue(
  replayGain: ReplayGainMetadata,
  key: keyof ReplayGainMetadata,
  value: number | undefined
): void {
  if (replayGain[key] === undefined && value !== undefined) {
    replayGain[key] = value;
  }
}

export function applyReplayGainComment(metadata: TrackMetadata, key: string, value: string): boolean {
  const normalizedKey = key.trim().toUpperCase();
  const replayGain = ensureReplayGain(metadata);

  switch (normalizedKey) {
    case 'REPLAYGAIN_TRACK_GAIN':
      assignReplayGainValue(replayGain, 'trackGainDb', normalizeReplayGainDb(value));
      break;
    case 'REPLAYGAIN_ALBUM_GAIN':
      assignReplayGainValue(replayGain, 'albumGainDb', normalizeReplayGainDb(value));
      break;
    case 'REPLAYGAIN_TRACK_PEAK':
      assignReplayGainValue(replayGain, 'trackPeak', normalizeReplayGainPeak(value));
      break;
    case 'REPLAYGAIN_ALBUM_PEAK':
      assignReplayGainValue(replayGain, 'albumPeak', normalizeReplayGainPeak(value));
      break;
    case 'R128_TRACK_GAIN':
      assignReplayGainValue(replayGain, 'trackGainDb', normalizeR128GainDb(value));
      break;
    case 'R128_ALBUM_GAIN':
      assignReplayGainValue(replayGain, 'albumGainDb', normalizeR128GainDb(value));
      break;
    default:
      if (Object.keys(replayGain).length === 0) {
        delete metadata.replayGain;
      }
      return false;
  }

  if (Object.keys(replayGain).length === 0) {
    delete metadata.replayGain;
  }

  return true;
}

function parseDecimalTagValue(value: string): number | undefined {
  const match = value.trim().match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);

  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}
