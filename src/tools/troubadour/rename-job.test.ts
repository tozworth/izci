import { describe, expect, it, vi } from 'vitest';
import { fingerprintFile } from '$lib/services/media-metadata/fingerprint';
import { applyRename, buildRenamePreview, type RenamePreviewRow, type RenameSource } from './rename-job';

function file(name = 'old.mp3', contents = 'audio'): File {
  return new File([contents], name, { type: 'audio/mpeg', lastModified: 100 });
}

function fileHandle(source: File) {
  return {
    kind: 'file' as const,
    name: source.name,
    getFile: vi.fn(async () => source)
  } as unknown as FileSystemFileHandle;
}

function source(id: string, proposedBaseName: string, overrides: Partial<RenameSource> = {}): RenameSource {
  const sourceFile = file();
  return {
    id,
    file: sourceFile,
    fileHandle: fileHandle(sourceFile),
    parentHandle: null,
    path: `Music/${sourceFile.name}`,
    proposedBaseName,
    extension: 'mp3',
    expectedLastModified: sourceFile.lastModified,
    expectedSize: sourceFile.size,
    ...overrides
  };
}

describe('Troubadour rename jobs', () => {
  it('blocks duplicate case-insensitive destinations and unavailable parents', async () => {
    const rows = await buildRenamePreview([
      source('one', 'Song'),
      source('two', 'song')
    ]);
    expect(rows.every((row) => row.problems.includes('missing-parent-handle'))).toBe(true);
    expect(rows.every((row) => row.problems.includes('duplicate-destination'))).toBe(true);
    expect(rows.every((row) => !row.enabled)).toBe(true);
  });

  it('copy-verifies before deleting the original', async () => {
    const oldFile = file();
    const copiedFile = file('new.mp3');
    const targetWritable = {
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
    const target = {
      kind: 'file' as const,
      name: 'new.mp3',
      getFile: vi.fn(async () => copiedFile),
      createWritable: vi.fn(async () => targetWritable)
    } as unknown as FileSystemFileHandle;
    let lookupCount = 0;
    const parent = {
      kind: 'directory' as const,
      name: 'Music',
      getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
        if (!options?.create && lookupCount++ === 0) throw new DOMException('Missing', 'NotFoundError');
        return target;
      }),
      removeEntry: vi.fn(async () => undefined)
    } as unknown as FileSystemDirectoryHandle;
    const row: RenamePreviewRow = {
      ...source('one', 'new', {
        file: oldFile,
        fileHandle: fileHandle(oldFile),
        parentHandle: parent,
        expectedSize: oldFile.size,
        expectedLastModified: oldFile.lastModified
      }),
      proposedName: 'new.mp3',
      proposedPath: 'Music/new.mp3',
      enabled: true,
      problems: [],
      warnings: []
    };

    const result = await applyRename(row);
    expect(result.success).toBe(true);
    expect(targetWritable.write).toHaveBeenCalledWith(oldFile);
    expect(targetWritable.close).toHaveBeenCalled();
    expect(parent.removeEntry).toHaveBeenLastCalledWith('old.mp3');
  });

  it('does not delete the original when destination verification fails', async () => {
    const oldFile = file();
    const target = {
      kind: 'file' as const,
      name: 'new.mp3',
      getFile: vi.fn(async () => file('new.mp3', 'wrong-size')),
      createWritable: vi.fn(async () => ({ write: async () => undefined, close: async () => undefined }))
    } as unknown as FileSystemFileHandle;
    const removed: string[] = [];
    const parent = {
      kind: 'directory' as const,
      name: 'Music',
      getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
        if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
        return target;
      }),
      removeEntry: vi.fn(async (name: string) => { removed.push(name); })
    } as unknown as FileSystemDirectoryHandle;
    const row: RenamePreviewRow = {
      ...source('one', 'new', { file: oldFile, fileHandle: fileHandle(oldFile), parentHandle: parent }),
      proposedName: 'new.mp3', proposedPath: 'Music/new.mp3', enabled: true, problems: [], warnings: []
    };

    const result = await applyRename(row);
    expect(result.success).toBe(false);
    expect(removed).toEqual(['new.mp3']);
    expect(removed).not.toContain('old.mp3');
  });

  it('applies extension, missing-token, and counter policies in preflight', async () => {
    const parent = {
      kind: 'directory' as const,
      name: 'Music',
      queryPermission: vi.fn(async () => 'granted' as const),
      getFileHandle: vi.fn(async () => { throw new DOMException('Missing', 'NotFoundError'); })
    } as unknown as FileSystemDirectoryHandle;
    const rows = await buildRenamePreview([
      source('one', 'Song', { parentHandle: parent, missingTokens: ['artist'] }),
      source('two', 'Song', { parentHandle: parent })
    ], {
      extensionCase: 'upper',
      missingTokenPolicy: 'empty',
      collisionPolicy: 'counter'
    });
    expect(rows[0]).toMatchObject({ proposedName: 'Song.MP3', enabled: true });
    expect(rows[0].warnings).toContain('missing:artist');
    expect(rows[1]).toMatchObject({ proposedName: 'Song (2).MP3', enabled: true });
    expect(rows[1].warnings).toContain('collision-counter');
  });

  it('reports prompt-only write access and detects same-size source changes by fingerprint', async () => {
    const original = file('old.mp3', 'audio');
    const changed = file('old.mp3', 'other');
    const expectedFingerprint = await fingerprintFile(original);
    const parent = {
      kind: 'directory' as const,
      name: 'Music',
      queryPermission: vi.fn(async () => 'prompt' as const),
      getFileHandle: vi.fn(async () => { throw new DOMException('Missing', 'NotFoundError'); })
    } as unknown as FileSystemDirectoryHandle;
    const rows = await buildRenamePreview([
      source('one', 'new', {
        file: original,
        fileHandle: fileHandle(changed),
        parentHandle: parent,
        expectedFingerprint
      })
    ]);
    expect(rows[0].problems).toEqual(expect.arrayContaining(['permission-required', 'source-changed']));
    expect(rows[0].enabled).toBe(false);
  });
});
