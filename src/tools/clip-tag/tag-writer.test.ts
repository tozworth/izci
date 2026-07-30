import { describe, expect, it } from 'vitest';
import { buildId3Tag, EMPTY_TAGS, parseId3, tagMp3 } from './tag-writer';

describe('ID3 tag writer', () => {
  it('round-trips editable text fields and artwork', async () => {
    const artwork = new Blob([new Uint8Array([1, 2, 3, 4]).buffer], { type: 'image/png' });
    const encoded = await buildId3Tag({
      ...EMPTY_TAGS,
      title: 'A title',
      artist: 'An artist',
      album: 'An album',
      year: '2026',
      trackNumber: '3/9'
    }, artwork);
    const parsed = parseId3(encoded);

    expect(parsed.tags).toMatchObject({
      title: 'A title',
      artist: 'An artist',
      album: 'An album',
      year: '2026',
      trackNumber: '3/9'
    });
    expect(parsed.artwork?.type).toBe('image/png');
    expect(new Uint8Array(await parsed.artwork!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('replaces the leading tag while preserving MP3 audio bytes', async () => {
    const originalTag = await buildId3Tag({ ...EMPTY_TAGS, title: 'Old title' }, null);
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 7, 8, 9]);
    const file = new File([originalTag.buffer as ArrayBuffer, audio.buffer], 'track.mp3', { type: 'audio/mpeg' });
    const output = new Uint8Array(await (await tagMp3(file, { ...EMPTY_TAGS, title: 'New title' }, null)).arrayBuffer());
    const parsed = parseId3(output);

    expect(parsed.tags.title).toBe('New title');
    expect(output.slice(-audio.length)).toEqual(audio);
  });
});
