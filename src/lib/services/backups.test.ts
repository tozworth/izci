import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, zipSync } from 'fflate';
import {
  BACKUP_ENTRY_MAX_BYTES,
  BACKUP_FORMAT_VERSION,
  BACKUP_MAX_COMPRESSED_BYTES,
  BACKUP_MAX_JSON_STRING_LENGTH,
  BACKUP_MAX_LIBRARY_RECORDS,
  BACKUP_MAX_UNCOMPRESSED_BYTES,
  decodeBackupArchive,
  encodeBackupArchive,
  type BackupArchiveData
} from './backups';

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;

function archiveEntries(data: BackupArchiveData): Record<string, Uint8Array> {
  const json = (value: unknown) => strToU8(JSON.stringify(value));
  return {
    'manifest.json': json(data.manifest),
    'settings.json': json(data.settings),
    'library.json': json(data.library),
    'folders.json': json(data.folders),
    'favorites.json': json(data.favorites),
    'progress.json': json(data.progress)
  };
}

function visitCentralDirectory(
  bytes: Uint8Array,
  visitor: (name: string, offset: number) => void
): void {
  for (let offset = 0; offset + 46 <= bytes.length;) {
    const signature = bytes[offset]
      | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24);
    if (signature !== CENTRAL_DIRECTORY_SIGNATURE) {
      offset += 1;
      continue;
    }
    const nameLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const extraLength = bytes[offset + 30] | (bytes[offset + 31] << 8);
    const commentLength = bytes[offset + 32] | (bytes[offset + 33] << 8);
    const name = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength));
    visitor(name, offset);
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function patchCentralOriginalSize(bytes: Uint8Array, entryName: string, size: number): Uint8Array {
  const patched = new Uint8Array(bytes);
  visitCentralDirectory(patched, (name, offset) => {
    if (name === entryName) writeUint32(patched, offset + 24, size);
  });
  return patched;
}

function renameCentralEntry(bytes: Uint8Array, from: string, to: string): Uint8Array {
  if (from.length !== to.length) throw new Error('test entry names must have equal lengths');
  const patched = new Uint8Array(bytes);
  visitCentralDirectory(patched, (name, offset) => {
    if (name === from) patched.set(strToU8(to), offset + 46);
  });
  return patched;
}

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
      'izci.experimental-settings': {
        multiplayer: true,
        multiplayerTurnSecret: 'must-not-survive'
      },
      'izci.file-launch.primary.v1': { owner: 'transient-window' }
    },
    library: [
      {
        id: 'track-1',
        name: 'Track.flac',
        format: 'flac',
        kind: 'stream',
        size: 123,
        lastModified: 456,
        path: 'Music/Album/Track.flac',
        sourceFolderId: 'folder-1',
        metadata: { title: 'Track', playCount: 7 },
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
      'izci.playback-settings': { logarithmicVolume: true },
      'izci.experimental-settings': { multiplayer: true }
    });
    expect(decoded.library[0]).toMatchObject({
      id: 'track-1',
      path: 'Music/Album/Track.flac',
      metadata: { title: 'Track', playCount: 7 },
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

  it('rejects compressed input and entries beyond their declared byte budgets', () => {
    expect(() => decodeBackupArchive(
      new Uint8Array(BACKUP_MAX_COMPRESSED_BYTES + 1)
    )).toThrow('invalid-backup');

    const entries = archiveEntries(archive());
    entries['manifest.json'] = strToU8(
      `${JSON.stringify(archive().manifest)}${' '.repeat(BACKUP_ENTRY_MAX_BYTES['manifest.json'])}`
    );
    expect(() => decodeBackupArchive(zipSync(entries))).toThrow('invalid-backup');
  });

  it('rejects archives whose declared uncompressed total exceeds its budget', () => {
    let patched = encodeBackupArchive(archive());
    for (const name of ['library.json', 'favorites.json', 'progress.json', 'settings.json'] as const) {
      patched = patchCentralOriginalSize(patched, name, BACKUP_ENTRY_MAX_BYTES[name]);
    }

    expect(() => decodeBackupArchive(patched)).toThrow('invalid-backup');
  });

  it('rejects unknown and duplicate archive entry names', () => {
    const unknownEntries = archiveEntries(archive());
    unknownEntries['private.json'] = strToU8('{}');
    expect(() => decodeBackupArchive(zipSync(unknownEntries))).toThrow('invalid-backup');

    const duplicate = renameCentralEntry(
      encodeBackupArchive(archive()),
      'progress.json',
      'settings.json'
    );
    expect(() => decodeBackupArchive(duplicate)).toThrow('invalid-backup');
  });

  it('rejects excess records and oversized JSON strings before normalization', () => {
    const records = Array.from({ length: BACKUP_MAX_LIBRARY_RECORDS + 1 }, () => null) as unknown;
    const excessRecords = archive({
      library: records as BackupArchiveData['library']
    });
    expect(() => decodeBackupArchive(encodeBackupArchive(excessRecords))).toThrow('invalid-backup');

    const oversizedString = archive();
    oversizedString.folders[0].name = 'x'.repeat(BACKUP_MAX_JSON_STRING_LENGTH + 1);
    expect(() => decodeBackupArchive(encodeBackupArchive(oversizedString))).toThrow('invalid-backup');
  });

  it('strips nested artwork, lyrics, and blob-like objects from restored metadata', () => {
    const data = archive();
    data.library[0].metadata = {
      title: 'Track',
      artwork: { data: 'image-payload' },
      lyrics: { text: 'transient lyrics' },
      replayGain: { trackGainDb: -1, blob: { type: 'application/octet-stream' } }
    } as unknown as NonNullable<BackupArchiveData['library'][number]['metadata']>;

    const decoded = decodeBackupArchive(encodeBackupArchive(data));
    expect(decoded.library[0].metadata).toEqual({
      title: 'Track',
      replayGain: { trackGainDb: -1 }
    });
    expect(JSON.stringify(decoded.library[0].metadata)).not.toMatch(/artwork|lyrics|blob|payload/);
  });
});
