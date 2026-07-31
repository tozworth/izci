import { describe, expect, it, vi } from 'vitest';
import { applyMetadataPatch } from './merge';
import { queryMetadataWritePermission, requestMetadataWritePermission } from './permissions';
import { readMetadataDocument } from './reader';
import { remuxMetadataToBlob } from './remux';
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

  it('streams an in-place write and verifies the committed metadata', async () => {
    let current = makeSilentWav();
    const document = await readMetadataDocument(current, 'wav');
    const createWritable = vi.fn(async () => {
      let staged = new Uint8Array();
      return new WritableStream({
        write(chunk: { type: 'write'; position: number; data: Uint8Array }) {
          const needed = chunk.position + chunk.data.byteLength;
          if (needed > staged.byteLength) {
            const expanded = new Uint8Array(needed);
            expanded.set(staged);
            staged = expanded;
          }
          staged.set(chunk.data, chunk.position);
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
