import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetadataDocument } from '$lib/services/media-metadata/types';

const { readMetadataDocument } = vi.hoisted(() => ({ readMetadataDocument: vi.fn() }));
const getMediaAccess = vi.hoisted(() => vi.fn());
vi.mock('$platform', async importOriginal => ({ ...await importOriginal<object>(), nativeFilesystem: { referenceScheme: 'file:', getMediaAccess } }));

vi.mock('$lib/services/media-metadata/reader', () => ({ readMetadataDocument }));

import { createTroubadourController } from './troubadour-controller';

function fileHandle(file: File) {
  const getFile = vi.fn(async () => file);
  return {
    handle: {
      kind: 'file',
      name: file.name,
      getFile
    } as unknown as FileSystemFileHandle,
    getFile
  };
}

function directoryHandle(name: string, children: FileSystemHandle[]): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      yield* children;
    }
  } as FileSystemDirectoryHandle;
}

function metadataDocument(file: File, extension: string): MetadataDocument {
  return {
    extension,
    fields: {},
    sourceTags: {},
    raw: {},
    artwork: [],
    fingerprint: {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      sampleHash: 'test'
    }
  } as unknown as MetadataDocument;
}

describe('Troubadour folder ingestion', () => {
  it('opens unmaterialized native batch references with transient editing targets', async () => {
    const file = new File(['audio'], 'Track.mp3');
    const access = { file: { name: file.name, nativeFile: { uri: 'file:///C:/Music/Track.mp3' }, getFile: async () => file }, parent: { name: 'Music' } };
    getMediaAccess.mockResolvedValue(access);
    const controller = createTroubadourController();
    await controller.ingestBatchTracks([{
      contextId: 'native', references: [{ collection: 'library', id: 'track' }],
      nativeFile: access.file.nativeFile, name: file.name, path: 'C:/Music/Track.mp3', extension: 'mp3', kind: 'stream', size: file.size, lastModified: file.lastModified
    }]);
    expect(controller.getSnapshot().items).toHaveLength(1);
    expect(controller.getSnapshot().items[0].fileHandle).toBe(access.file);
    expect(controller.getSnapshot().items[0].parentHandle).toBe(access.parent);
    expect(getMediaAccess).toHaveBeenCalledWith(access.file.nativeFile);
  });
  beforeEach(() => {
    readMetadataDocument.mockReset();
    readMetadataDocument.mockImplementation(async (file: File, extension: string) =>
      metadataDocument(file, extension)
    );
  });

  it('discovers supported files without copying their contents into memory', async () => {
    const supportedFile = new File(['audio'], 'Track.flac', { lastModified: 123 });
    const unsupportedFile = new File(['notes'], 'README.txt', { lastModified: 456 });
    const supported = fileHandle(supportedFile);
    const unsupported = fileHandle(unsupportedFile);
    const nested = directoryHandle('Album', [supported.handle, unsupported.handle]);
    const root = directoryHandle('Music', [nested]);
    const arrayBuffer = vi.spyOn(supportedFile, 'arrayBuffer');
    const controller = createTroubadourController();

    await controller.ingestDirectory(root, 2, 4);

    expect(controller.getSnapshot().items).toMatchObject([{
      file: supportedFile,
      fileHandle: supported.handle,
      parentHandle: nested,
      path: 'Music/Album/Track.flac',
      extension: 'flac',
      state: 'ready'
    }]);
    expect(supported.getFile).toHaveBeenCalledOnce();
    expect(unsupported.getFile).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('populates automatic album groups before metadata loading finishes', async () => {
    const file = new File([], 'Track.mp3');
    const track = fileHandle(file);
    const album = directoryHandle('Album', [track.handle]);
    const root = directoryHandle('Music', [album]);
    let finishMetadata!: (document: MetadataDocument) => void;
    readMetadataDocument.mockImplementation(() => new Promise((resolve) => {
      finishMetadata = resolve;
    }));
    const controller = createTroubadourController();

    const loading = controller.ingestDirectory(root, 2, 4, 'folder');

    await vi.waitFor(() => {
      expect(controller.getSnapshot().busy).toBe(true);
      expect(controller.getSnapshot().albums).toMatchObject([{
        title: 'Album',
        itemIds: [controller.getSnapshot().items[0].id]
      }]);
    });
    finishMetadata(metadataDocument(file, 'mp3'));
    await loading;

    expect(controller.getSnapshot().busy).toBe(false);
    expect(controller.getSnapshot().items[0].state).toBe('ready');
  });

  it('batches workbench publications for large folders', async () => {
    const handles = Array.from({ length: 7_000 }, (_, index) =>
      fileHandle(new File([], `Track ${index}.mp3`)).handle
    );
    const root = directoryHandle('Music', handles);
    const controller = createTroubadourController();
    let publications = 0;
    const unsubscribe = controller.subscribe(() => {
      publications += 1;
    });

    await controller.ingestDirectory(root, 0, 4);
    unsubscribe();

    expect(controller.getSnapshot().items).toHaveLength(7_000);
    expect(controller.getSnapshot().items.every((item) => item.state === 'ready')).toBe(true);
    expect(publications).toBeLessThan(400);
  });
});
