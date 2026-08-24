import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetadataDocument } from '$lib/services/media-metadata/types';

const { readMetadataDocument } = vi.hoisted(() => ({ readMetadataDocument: vi.fn() }));

vi.mock('$lib/services/media-metadata/reader', () => ({ readMetadataDocument }));
vi.mock('$lib/services/troubadour-sync', () => ({
  publishTroubadourBatchResult: vi.fn(),
  requestTroubadourWritePreparation: vi.fn(async () => true)
}));
vi.mock('$lib/services/logging', () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
  logWarning: vi.fn()
}));

import { createTroubadourController } from './troubadour-controller';

function fileHandle(file: File) {
  const getFile = vi.fn(async () => file);
  return {
    handle: {
      kind: 'file',
      name: file.name,
      getFile,
      createWritable: async () => ({
        write: vi.fn(),
        close: vi.fn()
      })
    } as unknown as FileSystemFileHandle,
    getFile
  };
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

interface SlowSaveOptions {
  started?: () => void;
  release: Promise<void>;
}

/**
 * Save handler that hangs until `release` resolves, so a test can cancel mid-batch.
 * Writes nothing; the first call aborts with the batch signal when cancelled.
 */
function hangingSaveHandler(options: SlowSaveOptions) {
  return vi.fn(async (request: { item: { file: File; extension: string }; signal?: AbortSignal }) => {
    options.started?.();
    await options.release;
    request.signal?.throwIfAborted();
    const document = metadataDocument(request.item.file, request.item.extension);
    return { document, verified: true };
  });
}

describe('Troubadour batch cancellation', () => {
  beforeEach(() => {
    readMetadataDocument.mockReset();
    readMetadataDocument.mockImplementation(async (file: File, extension: string) =>
      metadataDocument(file, extension)
    );
  });

  it('stops a save batch mid-run and leaves remaining files dirty', async () => {
    const files = Array.from({ length: 4 }, (_, index) =>
      fileHandle(new File(['audio'], `Track ${index + 1}.mp3`, { lastModified: index }))
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let startedCount = 0;
    const controller = createTroubadourController(hangingSaveHandler({
      release: gate,
      started: () => {
        startedCount += 1;
        if (startedCount === 1) {
          setTimeout(() => {
            expect(controller.cancelActiveJob()).toBe(true);
            release();
          }, 0);
        }
      }
    }));

    await controller.ingestHandles(files.map((entry) => entry.handle));
    controller.selectAll();
    // Stage a patch on every item so the batch has work to do.
    for (const item of controller.getSnapshot().items) {
      controller.editItemField(item.id, 'title', 'Staged');
    }

    const results = await controller.saveAndPublish({ all: true });

    expect(controller.getSnapshot().busy).toBe(false);
    expect(results.length).toBeLessThan(4);
    expect(controller.getSnapshot().items.some((item) => Object.keys(item.patch).length)).toBe(true);
  });

  it('reports idle cancellation as a no-op', async () => {
    const controller = createTroubadourController();
    expect(controller.cancelActiveJob()).toBe(false);
  });

  it('cancels a later file load after a save batch has completed', async () => {
    const saved = fileHandle(new File(['audio'], 'Saved.mp3'));
    const controller = createTroubadourController(hangingSaveHandler({ release: Promise.resolve() }));
    await controller.ingestHandles([saved.handle]);
    const savedItem = controller.getSnapshot().items[0];
    controller.editItemField(savedItem.id, 'title', 'Saved title');
    await controller.saveAndPublish();

    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => (releaseLoad = resolve));
    const laterFile = new File(['later'], 'Later.mp3');
    const laterHandle = {
      kind: 'file',
      name: laterFile.name,
      getFile: vi.fn(async () => {
        await loadGate;
        return laterFile;
      })
    } as unknown as FileSystemFileHandle;

    const loading = controller.ingestHandles([laterHandle]);
    await vi.waitFor(() => expect(laterHandle.getFile).toHaveBeenCalledOnce());
    expect(controller.cancelActiveJob()).toBe(true);
    releaseLoad();
    await loading;

    expect(controller.getSnapshot().items.map((item) => item.file.name)).toEqual(['Saved.mp3']);
    expect(controller.getSnapshot().busy).toBe(false);
  });
});
