import { describe, expect, it } from 'vitest';
import { editableTagsToMetadata } from './clip-metadata';
import type { EditableTags } from './tag-writer';

const TAGS: EditableTags = {
  title: ' Song ',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  composer: 'Composer',
  genre: 'Genre',
  year: '2026',
  trackNumber: '3/12',
  discNumber: '2/3'
};

describe('clip export metadata', () => {
  it('normalizes numbered fields and artwork', async () => {
    const metadata = await editableTagsToMetadata(
      TAGS,
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      'flac'
    );

    expect(metadata).toMatchObject({
      title: 'Song',
      trackNumber: 3,
      tracksTotal: 12,
      discNumber: 2,
      discsTotal: 3,
      raw: { COMPOSER: 'Composer' }
    });
    expect(metadata.images?.[0]).toMatchObject({
      mimeType: 'image/png',
      kind: 'coverFront',
      data: new Uint8Array([1, 2, 3])
    });
  });

  it('uses the ID3 composer frame for MP3 output', async () => {
    const metadata = await editableTagsToMetadata(TAGS, null, 'mp3');
    expect(metadata.raw).toEqual({ TCOM: 'Composer' });
  });

  it('uses the ID3 composer frame for WAV output', async () => {
    const metadata = await editableTagsToMetadata(TAGS, null, 'wav');
    expect(metadata.raw).toEqual({ TCOM: 'Composer' });
  });
});
