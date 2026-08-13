import type { ReplayGainMetadata, TrackMetadata } from '$lib/contracts/media-metadata';

export const TRACK_METADATA_MAX_TEXT_LENGTH = 4_096;
export const TRACK_METADATA_MAX_MESSAGE_LENGTH = 64 * 1_024;
export const TRACK_METADATA_MAX_SUBSONG_NAMES = 1_024;
export const TRACK_METADATA_MAX_TOTAL_TEXT_LENGTH = 128 * 1_024;

const TEXT_FIELDS = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'genre',
  'year',
  'trackNumber',
  'discNumber',
  'composer',
  'trackerType',
  'originalType'
] as const satisfies readonly (keyof TrackMetadata)[];

const COUNT_FIELDS = [
  'channels',
  'tracks',
  'patterns',
  'instruments',
  'orders',
  'subsongs',
  'rows',
  'sampleRate',
  'playCount'
] as const satisfies readonly (keyof TrackMetadata)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function projectReplayGain(value: unknown): ReplayGainMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const replayGain: ReplayGainMetadata = {};
  const trackGainDb = finiteNumber(value.trackGainDb);
  const trackPeak = finiteNonNegative(value.trackPeak);
  const albumGainDb = finiteNumber(value.albumGainDb);
  const albumPeak = finiteNonNegative(value.albumPeak);
  if (trackGainDb !== undefined) replayGain.trackGainDb = trackGainDb;
  if (trackPeak !== undefined) replayGain.trackPeak = trackPeak;
  if (albumGainDb !== undefined) replayGain.albumGainDb = albumGainDb;
  if (albumPeak !== undefined) replayGain.albumPeak = albumPeak;
  return Object.keys(replayGain).length > 0 ? replayGain : undefined;
}

/**
 * Projects untrusted runtime data onto the complete, bounded durable metadata surface.
 * Unknown, malformed, nested presentation, and oversized values are discarded.
 */
export function projectTrackMetadata(value: unknown): TrackMetadata | undefined {
  if (!isRecord(value)) return undefined;

  const metadata: TrackMetadata = {};
  let textLength = 0;
  const includeText = (key: typeof TEXT_FIELDS[number] | 'message', maximum: number): void => {
    const candidate = value[key];
    if (
      typeof candidate !== 'string'
      || candidate.length > maximum
      || textLength + candidate.length > TRACK_METADATA_MAX_TOTAL_TEXT_LENGTH
    ) return;
    metadata[key] = candidate;
    textLength += candidate.length;
  };

  for (const key of TEXT_FIELDS) includeText(key, TRACK_METADATA_MAX_TEXT_LENGTH);
  includeText('message', TRACK_METADATA_MAX_MESSAGE_LENGTH);

  if (typeof value.embeddedMetadataLoaded === 'boolean') {
    metadata.embeddedMetadataLoaded = value.embeddedMetadataLoaded;
  }

  const duration = finiteNonNegative(value.duration);
  const bitrate = finiteNonNegative(value.bitrate);
  if (duration !== undefined) metadata.duration = duration;
  if (bitrate !== undefined) metadata.bitrate = bitrate;

  for (const key of COUNT_FIELDS) {
    const count = nonNegativeSafeInteger(value[key]);
    if (count !== undefined) metadata[key] = count;
  }

  if (
    Array.isArray(value.subsongNames)
    && value.subsongNames.length <= TRACK_METADATA_MAX_SUBSONG_NAMES
    && value.subsongNames.every((name) => (
      typeof name === 'string' && name.length <= TRACK_METADATA_MAX_TEXT_LENGTH
    ))
  ) {
    const namesLength = value.subsongNames.reduce((total, name) => total + name.length, 0);
    if (textLength + namesLength <= TRACK_METADATA_MAX_TOTAL_TEXT_LENGTH) {
      metadata.subsongNames = [...value.subsongNames];
      textLength += namesLength;
    }
  }

  const replayGain = projectReplayGain(value.replayGain);
  if (replayGain) metadata.replayGain = replayGain;

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
