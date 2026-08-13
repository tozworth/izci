import { describe, expect, it } from 'vitest';
import {
  projectTrackMetadata,
  TRACK_METADATA_MAX_MESSAGE_LENGTH,
  TRACK_METADATA_MAX_SUBSONG_NAMES,
  TRACK_METADATA_MAX_TEXT_LENGTH
} from './track-metadata';

describe('track metadata projection', () => {
  it('copies the complete durable surface and excludes unknown nested payloads', () => {
    const subsongNames = ['Main', 'Bonus'];
    const projected = projectTrackMetadata({
      title: 'Track',
      artist: 'Artist',
      embeddedMetadataLoaded: true,
      message: 'Module message',
      duration: 120,
      channels: 2,
      subsongNames,
      replayGain: { trackGainDb: -1.5, trackPeak: 0.9, artwork: { bytes: [1, 2, 3] } },
      artwork: { mimeType: 'image/png', data: 'blob-looking-payload' },
      lyrics: { synchronized: [{ time: 1, text: 'Transient' }] },
      blob: { size: 4_000_000, type: 'image/jpeg', arrayBuffer: 'payload' }
    });

    subsongNames[0] = 'Changed';
    expect(projected).toEqual({
      title: 'Track',
      artist: 'Artist',
      embeddedMetadataLoaded: true,
      message: 'Module message',
      duration: 120,
      channels: 2,
      subsongNames: ['Main', 'Bonus'],
      replayGain: { trackGainDb: -1.5, trackPeak: 0.9 }
    });
    expect(JSON.stringify(projected)).not.toMatch(/artwork|lyrics|blob|payload|Transient/);
  });

  it('drops malformed, non-finite, and oversized values', () => {
    expect(projectTrackMetadata({
      title: 'x'.repeat(TRACK_METADATA_MAX_TEXT_LENGTH + 1),
      message: 'x'.repeat(TRACK_METADATA_MAX_MESSAGE_LENGTH + 1),
      duration: Number.POSITIVE_INFINITY,
      bitrate: -1,
      channels: 1.5,
      tracks: Number.MAX_SAFE_INTEGER + 1,
      subsongNames: Array.from({ length: TRACK_METADATA_MAX_SUBSONG_NAMES + 1 }, () => 'Subsong'),
      replayGain: { trackGainDb: Number.NaN, trackPeak: -0.1 }
    })).toBeUndefined();
    expect(projectTrackMetadata(['not', 'metadata'])).toBeUndefined();
  });
});
