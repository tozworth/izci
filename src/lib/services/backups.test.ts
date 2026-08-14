import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  decodeBackupArchive,
  encodeBackupArchive,
  type BackupArchiveData
} from './backups';

function archive(overrides: Partial<BackupArchiveData> = {}): BackupArchiveData {
  return {
    manifest: {
      kind: 'izci-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: '2026-07-26T12:00:00.000Z',
      appVersion: '0.2.1',
      sourceOrigin: 'http://localhost:5173',
      contents: {
        settings: 1,
        libraryTracks: 1,
        folders: 1,
        favorites: 0,
        playbackProgress: 1
      }
    },
    settings: {
      'izci.playback-settings': { logarithmicVolume: true },
      'izci.file-launch.primary.v1': { owner: 'transient-window' }
    },
    library: [
      {
        id: 'track-1',
        name: 'Track.flac',
        extension: 'flac',
        kind: 'stream',
        size: 123,
        lastModified: 456,
        path: 'Music/Album/Track.flac',
        sourceFolderId: 'folder-1',
        metadata: { title: 'Track', playCount: 7, lastPlayed: 456 },
        rating: 3.5
      }
    ],
    folders: [
      {
        id: 'folder-1',
        name: 'Music',
        addedAt: 123,
        libraryMode: 'launch'
      }
    ],
    favorites: [],
    progress: [
      {
        identity: 'path:music/album/track.flac:123:456:subsong:all',
        currentTime: 42,
        duration: 240,
        updatedAt: 789
      }
    ],
    ...overrides
  };
}

describe('izci backup archives', () => {
  it('round-trips portable settings and library data through a zip', () => {
    const decoded = decodeBackupArchive(encodeBackupArchive(archive()));

    expect(decoded.manifest.sourceOrigin).toBe('http://localhost:5173');
    expect(decoded.settings).toEqual({
      'izci.playback-settings': { logarithmicVolume: true }
    });
    expect(decoded.library[0]).toMatchObject({
      id: 'track-1',
      path: 'Music/Album/Track.flac',
      metadata: { title: 'Track', playCount: 7, lastPlayed: 456 },
      rating: 3.5
    });
    expect(decoded.folders[0]).toMatchObject({ id: 'folder-1', libraryMode: 'launch' });
    expect(decoded.progress[0]).toMatchObject({ currentTime: 42, duration: 240 });
  });

  it('rejects archives from an unsupported format version', () => {
    const data = archive();
    data.manifest.formatVersion += 1;

    expect(() => decodeBackupArchive(encodeBackupArchive(data))).toThrow('unsupported-version');
  });

  it('rejects bytes that are not an izci backup zip', () => {
    expect(() => decodeBackupArchive(new Uint8Array([1, 2, 3]))).toThrow('invalid-backup');
  });
});
