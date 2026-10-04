import { describe, expect, it, vi } from 'vitest';
import { isSameArtworkFile } from './artwork';
import { applyMetadataPatch } from './merge';
import { queryMetadataWritePermission, requestMetadataWritePermission } from './permissions';
import { readMetadataDocument } from './reader';
import { remuxMetadataToBlob, remuxMetadataToWritable } from './remux';
import type { MediaMetadataFields, MetadataDocument } from './types';
import { writeMetadataDocumentInPlace } from './writer';

function makeSilentWav(lastModified = 123): File {
  const frameCount = 480;
  const bytes = new Uint8Array(44 + frameCount * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48_000, true);
  view.setUint32(28, 96_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frameCount * 2, true);
  return new File([bytes], 'silence.wav', { type: 'audio/wav', lastModified });
}

function emptyFields(overrides: Partial<MediaMetadataFields> = {}): MediaMetadataFields {
  return {
    title: '', artist: '', albumArtist: '', album: '', date: '', trackNumber: '', tracksTotal: '',
    discNumber: '', discsTotal: '', genre: '', composer: '', comment: '', lyrics: '', isrc: '', bpm: '',
    grouping: '', copyright: '', titleSort: '', artistSort: '', albumSort: '', albumArtistSort: '',
    composerSort: '', ...overrides
  };
}

describe('metadata patch merging', () => {
  it('recognizes identical artwork files without conflating different bytes or MIME types', () => {
    const artwork = { data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' };
    expect(isSameArtworkFile(artwork, { data: new Uint8Array([1, 2, 3]), mimeType: 'IMAGE/JPEG' })).toBe(true);
    expect(isSameArtworkFile(artwork, { data: new Uint8Array([1, 2, 4]), mimeType: 'image/jpeg' })).toBe(false);
    expect(isSameArtworkFile(artwork, { data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' })).toBe(false);
  });

  it('distinguishes untouched fields from explicit clears and preserves unknown raw frames', () => {
    const document: MetadataDocument = {
      extension: 'mp3',
      fields: emptyFields({ title: 'Old title', composer: 'Old composer' }),
      sourceTags: {
        title: 'Old title',
        raw: { TIT2: 'Old title', TCOM: 'Old composer', TXXX: { MOOD: 'Calm' }, PRIV: new Uint8Array([1, 2]) }
      },
      raw: { TIT2: 'Old title', TCOM: 'Old composer', TXXX: { MOOD: 'Calm' }, PRIV: new Uint8Array([1, 2]) },
      artwork: [],
      fingerprint: Object.freeze({ name: 'song.mp3', size: 1, lastModified: 1, sampleHash: 'abc' })
    };

    const applied = applyMetadataPatch(document, { title: 'New title', composer: null });
    expect(applied.fields).toMatchObject({ title: 'New title', composer: '' });
    expect(applied.tags.raw).not.toHaveProperty('TIT2');
    expect(applied.tags.raw).not.toHaveProperty('TCOM');
    expect(applied.tags.raw?.TXXX).toEqual({ MOOD: 'Calm' });
    expect(applied.tags.raw?.PRIV).toEqual(new Uint8Array([1, 2]));
    expect(document.sourceTags.raw).toHaveProperty('TCOM', 'Old composer');
  });

  it('targets one artwork slot without dropping other embedded images', () => {
    const front = { id: 'front', data: new Uint8Array([1]), mimeType: 'image/png', kind: 'coverFront' as const, size: 1 };
    const back = { id: 'back', data: new Uint8Array([2]), mimeType: 'image/jpeg', kind: 'coverBack' as const, size: 1 };
    const document: MetadataDocument = {
      extension: 'flac', fields: emptyFields(), sourceTags: {}, raw: {}, artwork: [front, back],
      fingerprint: Object.freeze({ name: 'song.flac', size: 1, lastModified: 1, sampleHash: 'abc' })
    };
    const applied = applyMetadataPatch(document, {}, {
      type: 'replace', targetId: 'front',
      artwork: { data: new Uint8Array([9]), mimeType: 'image/webp', kind: 'coverFront' }
    });
    expect(applied.artwork.map((image) => [...image.data])).toEqual([[9], [2]]);
    expect(applied.artwork[1].id).toBe('back');
    expect(document.artwork[0].data).toEqual(new Uint8Array([1]));
  });
});

describe('metadata fixtures and writes', () => {
  it('round-trips normalized and advanced fields through a WAVE ID3 remux', async () => {
    const seeded = await remuxMetadataToBlob(makeSilentWav(), 'wav', {
      title: 'Old title',
      images: [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png', kind: 'coverFront' }],
      raw: { TXXX: { MOOD: 'Calm' }, PRIV: new Uint8Array([7, 8, 9]) }
    });
    const seededFile = new File([seeded], 'silence.wav', { type: seeded.type, lastModified: 234 });
    const document = await readMetadataDocument(seededFile, 'wav');
    const applied = applyMetadataPatch(document, { title: 'Quiet', composer: 'A. Composer' });
    const tagged = await remuxMetadataToBlob(seededFile, 'wav', applied.tags);
    const reread = await readMetadataDocument(
      new File([tagged], 'silence.wav', { type: tagged.type, lastModified: 456 }),
      'wav'
    );
    expect(reread.fields.title).toBe('Quiet');
    expect(reread.fields.composer).toBe('A. Composer');
    expect(reread.raw.TXXX).toEqual({ MOOD: 'Calm' });
    expect(reread.raw.PRIV).toEqual(new Uint8Array([7, 8, 9]));
    expect(reread.artwork).toHaveLength(1);
    expect(reread.artwork[0].data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('writes in place and verifies the committed metadata', async () => {
    let current = makeSilentWav();
    const document = await readMetadataDocument(current, 'wav');
    const createWritable = vi.fn(async () => {
      let staged = new Uint8Array();
      return new WritableStream({
        async write(chunk: Blob | { type: 'write'; position: number; data: Uint8Array }) {
          const position = chunk instanceof Blob ? 0 : chunk.position;
          const data = chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : chunk.data;
          const needed = position + data.byteLength;
          if (needed > staged.byteLength) {
            const expanded = new Uint8Array(needed);
            expanded.set(staged);
            staged = expanded;
          }
          staged.set(data, position);
        },
        close() {
          current = new File([staged], 'silence.wav', { type: 'audio/wav', lastModified: 456 });
        }
      }) as FileSystemWritableFileStream;
    });
    const handle = {
      kind: 'file', name: current.name,
      getFile: async () => current,
      queryPermission: async () => 'granted' as const,
      createWritable
    } as unknown as FileSystemFileHandle;

    const result = await writeMetadataDocumentInPlace(handle, document, { title: 'Committed' });
    expect(result.verified).toBe(true);
    expect(result.document.fields.title).toBe('Committed');
    expect(createWritable).toHaveBeenCalledWith({ keepExistingData: false });
  });

  it('materializes disk-backed files before remuxing and verifying', async () => {
    class DiskBackedFile extends File {
      invalidated = false;
      sliceReads = 0;

      override async arrayBuffer(): Promise<ArrayBuffer> {
        if (this.invalidated) throw new DOMException('The source snapshot is no longer readable.', 'NotReadableError');
        return super.arrayBuffer();
      }

      override slice(start?: number, end?: number, contentType?: string): Blob {
        this.sliceReads += 1;
        const source = this;
        const slice = super.slice(start, end, contentType);
        const read = slice.arrayBuffer.bind(slice);
        slice.arrayBuffer = async () => {
          if (source.invalidated) throw new DOMException('The source snapshot is no longer readable.', 'NotReadableError');
          return read();
        };
        return slice;
      }
    }

    const initial = makeSilentWav();
    let current: File = new DiskBackedFile([await initial.arrayBuffer()], initial.name, {
      type: initial.type,
      lastModified: initial.lastModified
    });
    const document = await readMetadataDocument(current, 'wav');
    const createWritable = vi.fn(async () => {
      (current as DiskBackedFile).invalidated = true;
      let staged = new Uint8Array();
      return new WritableStream({
        async write(chunk: Blob | { type: 'write'; position: number; data: Uint8Array }) {
          const position = chunk instanceof Blob ? 0 : chunk.position;
          const data = chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : chunk.data;
          const needed = position + data.byteLength;
          if (needed > staged.byteLength) {
            const expanded = new Uint8Array(needed);
            expanded.set(staged);
            staged = expanded;
          }
          staged.set(data, position);
        },
        close() {
          current = new DiskBackedFile([staged], initial.name, { type: initial.type, lastModified: 456 });
        }
      }) as FileSystemWritableFileStream;
    });
    const handle = {
      kind: 'file', name: current.name,
      getFile: async () => current,
      queryPermission: async () => 'granted' as const,
      createWritable
    } as unknown as FileSystemFileHandle;

    const result = await writeMetadataDocumentInPlace(handle, document, { title: 'Stable source' });

    expect(result.document.fields.title).toBe('Stable source');
    expect(createWritable).toHaveBeenCalledOnce();
    expect((current as DiskBackedFile).sliceReads).toBe(0);
  });

  it('releases the native writable lock when finalizing the remux fails', async () => {
    const writable = new WritableStream({
      write: () => undefined,
      close: () => {
        throw new DOMException('The atomic commit failed.', 'InvalidStateError');
      }
    }) as FileSystemWritableFileStream;

    await expect(remuxMetadataToWritable(
      makeSilentWav(),
      'wav',
      { title: 'Uncommitted' },
      writable
    )).rejects.toMatchObject({ name: 'InvalidStateError' });

    expect(writable.locked).toBe(false);
  });
  it('aborts staged bytes when cancellation arrives during writing, before atomic commit', async () => {
    const controller = new AbortController();
    const close = vi.fn();
    const abort = vi.fn(async () => undefined);
    const writable = Object.assign(new WritableStream<FileSystemWriteChunkType>(), {
      write: async () => controller.abort(), close, abort
    });
    await expect(remuxMetadataToWritable(makeSilentWav(), 'wav', { title: 'Cancelled' }, writable, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(close).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
  });

  it('blocks an externally changed file before creating a writable', async () => {
    const document = await readMetadataDocument(makeSilentWav(), 'wav');
    const createWritable = vi.fn();
    const handle = {
      kind: 'file', name: 'silence.wav',
      getFile: async () => makeSilentWav(999),
      queryPermission: async () => 'granted' as const,
      createWritable
    } as unknown as FileSystemFileHandle;
    await expect(writeMetadataDocumentInPlace(handle, document, { title: 'Nope' }))
      .rejects.toMatchObject({ code: 'external-change' });
    expect(createWritable).not.toHaveBeenCalled();
  });
});

describe('write permissions', () => {
  it('queries without prompting and only requests through the explicit helper', async () => {
    const queryPermission = vi.fn(async () => 'prompt' as const);
    const requestPermission = vi.fn(async () => 'granted' as const);
    const handle = {
      kind: 'file', name: 'song.mp3', getFile: vi.fn(), createWritable: vi.fn(),
      queryPermission, requestPermission
    } as unknown as FileSystemFileHandle;
    await expect(queryMetadataWritePermission(handle)).resolves.toBe('prompt');
    expect(requestPermission).not.toHaveBeenCalled();
    await expect(requestMetadataWritePermission(handle)).resolves.toBe('granted');
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });
});
