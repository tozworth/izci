import { describe, expect, it } from 'vitest';
import {
  projectMultiplayerPlaybackSnapshot,
  sanitizeMediaEntity,
  sanitizeTrackMetadata
} from './multiplayer-host-projection';

describe('multiplayer host projection', () => {
  it('removes local file capabilities and unknown application fields from shared tracks', () => {
    const file = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' });
    const item = sanitizeMediaEntity({
      id: 'one',
      file,
      objectUrl: 'blob:secret',
      sourceFolderId: 'private-folder',
      name: 'song.mp3',
      path: 'Music/song.mp3',
      format: 'mp3',
      kind: 'stream',
      size: 5,
      lastModified: 1,
      metadata: { title: 'Song' }
    } as unknown as import('$lib/contracts/catalog').MediaEntity);

    expect(item).toEqual({
      id: 'one',
      name: 'song.mp3',
      path: 'Music/song.mp3',
      extension: 'mp3',
      kind: 'stream',
      size: 5,
      lastModified: 1,
      metadata: { title: 'Song' }
    });
  });

  it('projects every current metadata field while excluding future structural additions', () => {
    const projected = sanitizeTrackMetadata({
      title: 'Song',
      embeddedMetadataLoaded: true,
      duration: 120,
      bitrate: 192,
      channels: 2,
      subsongNames: ['Main'],
      sampleRate: 48_000,
      replayGain: { trackGainDb: -1.5, trackPeak: 0.9 },
      localOnly: 'secret'
    } as Parameters<typeof sanitizeTrackMetadata>[0] & { localOnly: string });

    expect(projected).toEqual({
      title: 'Song',
      embeddedMetadataLoaded: true,
      duration: 120,
      bitrate: 192,
      channels: 2,
      subsongNames: ['Main'],
      sampleRate: 48_000,
      replayGain: { trackGainDb: -1.5, trackPeak: 0.9 }
    });
  });

  it('projects playback explicitly and copies buffered ranges', () => {
    const buffered: Array<[number, number]> = [[0, 12]];
    const projected = projectMultiplayerPlaybackSnapshot({
      state: 'playing',
      currentTime: 5,
      duration: 12,
      volume: 0.75,
      muted: false,
      backend: 'stream',
      buffered,
      error: ''
    });

    buffered[0][1] = 99;
    expect(projected).toEqual({
      state: 'playing',
      currentTime: 5,
      duration: 12,
      volume: 0.75,
      muted: false,
      backend: 'stream',
      buffered: [[0, 12]],
      error: ''
    });
  });
});
