import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEmbeddedStreamArtwork } from './stream-artwork';
import { loadTrackLyrics } from './lyrics';
import type { TrackItem } from '$lib/types';

const { materializePlatformFile, preparePlaybackRestoration } = vi.hoisted(() => ({
  materializePlatformFile: vi.fn(), preparePlaybackRestoration: vi.fn()
}));
vi.mock('$platform', () => ({ isDesktop: true, materializePlatformFile, preparePlaybackRestoration }));

afterEach(() => {
  vi.unstubAllGlobals();
  materializePlatformFile.mockReset();
  preparePlaybackRestoration.mockReset();
});
const encoder = new TextEncoder();
const concatenate = (...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
};
const uint32 = (value: number, littleEndian = false) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, littleEndian);
  return bytes;
};
function picture(type: number, data: Uint8Array) {
  const mime = encoder.encode('image/png');
  return concatenate(uint32(type), uint32(mime.length), mime, uint32(0),
    uint32(500), uint32(500), uint32(24), uint32(0), uint32(data.length), data);
}
function block(type: number, bytes: Uint8Array, last = false) {
  return concatenate(new Uint8Array([type | (last ? 0x80 : 0), bytes.length >> 16, bytes.length >> 8, bytes.length]), bytes);
}
function ogg(packets: Uint8Array[], maxPageSegments = 255) {
  const pages: Uint8Array[] = [];
  for (const packet of packets) {
    const laces = [...Array(Math.floor(packet.length / 255)).fill(255), packet.length % 255];
    let offset = 0;
    for (let index = 0; index < laces.length; index += maxPageSegments) {
      const segments = laces.slice(index, index + maxPageSegments);
      const length = segments.reduce((sum, n) => sum + n, 0);
      const header = new Uint8Array(27);
      header.set(encoder.encode('OggS'));
      header[5] = index > 0 ? 1 : 0;
      header[26] = segments.length;
      new DataView(header.buffer).setUint32(14, 1, true);
      pages.push(concatenate(header, new Uint8Array(segments), packet.subarray(offset, offset + length)));
      offset += length;
    }
  }
  return concatenate(...pages);
}
function opusComments(comments: Uint8Array[]) {
  return concatenate(encoder.encode('OpusTags'), uint32(0, true), uint32(comments.length, true),
    ...comments.flatMap(c => [uint32(c.length, true), c]));
}
function track(file: File): TrackItem {
  return { id: file.name, name: file.name, kind: 'stream', extension: file.name.split('.').at(-1)!,
    size: file.size, lastModified: file.lastModified, file };
}
function reads(file: File) {
  vi.stubGlobal('navigator', { userAgent: 'Windows NT' });
  const full = vi.spyOn(file, 'arrayBuffer');
  const slice = vi.spyOn(file, 'slice');
  return { full, slice, total: () => slice.mock.calls.reduce((sum, [start, end]) => sum + Number(end) - Number(start), 0) };
}

describe('ranged embedded artwork', () => {
  it.each(['flac', 'opus'])('reads artwork from restored native %s paths without playback', async (extension) => {
    const cover = new Uint8Array([1, 2, 3, 4]);
    const encoded = btoa(String.fromCharCode(...picture(3, cover)));
    const bytes = extension === 'flac'
      ? concatenate(encoder.encode('fLaC'), block(6, picture(3, cover), true))
      : ogg([encoder.encode('OpusHead'), opusComments([encoder.encode(`METADATA_BLOCK_PICTURE=${encoded}`)])]);
    const file = new File([bytes], `restored.${extension}`);
    const restored = { ...track(file), file: undefined, desktopFile: true as const, path: `C:/Music/${file.name}` };
    materializePlatformFile.mockResolvedValue(file);

    const artwork = await loadEmbeddedStreamArtwork(restored);

    expect(materializePlatformFile).toHaveBeenCalledWith(restored.path);
    expect(new Uint8Array(await artwork!.blob.arrayBuffer())).toEqual(cover);
    expect(restored.file).toBeUndefined();
  });

  it('distinguishes an unavailable source from a readable file without artwork', async () => {
    const file = new File([encoder.encode('fLaC'), block(1, new Uint8Array(8), true)], 'empty.flac');
    await expect(loadEmbeddedStreamArtwork(track(file))).resolves.toBeNull();
    await expect(loadEmbeddedStreamArtwork({ ...track(file), file: undefined })).rejects.toThrow();
    const fileHandle = { getFile: vi.fn().mockRejectedValue(new Error('Permission unavailable')) } as unknown as FileSystemFileHandle;
    await expect(loadEmbeddedStreamArtwork({ ...track(file), file: undefined, fileHandle })).rejects.toThrow('Permission unavailable');
    await expect(loadEmbeddedStreamArtwork({ ...track(file), fileHandle })).resolves.toBeNull();
  });

  it('restores desktop handle permissions before reading artwork without starting playback', async () => {
    const cover = new Uint8Array([1, 2, 3]);
    const file = new File([concatenate(encoder.encode('fLaC'), block(6, picture(3, cover), true))], 'saved.flac');
    let granted = false;
    const fileHandle = { getFile: vi.fn(async () => {
      if (!granted) throw new Error('Permission unavailable');
      return file;
    }) } as unknown as FileSystemFileHandle;
    const saved = { ...track(file), file: undefined, fileHandle };
    preparePlaybackRestoration.mockImplementation(async () => { granted = true; });
    const artwork = await loadEmbeddedStreamArtwork(saved);
    expect(preparePlaybackRestoration).toHaveBeenCalledWith(saved);
    expect(new Uint8Array(await artwork!.blob.arrayBuffer())).toEqual(cover);
  });

  it('skips FLAC padding and audio and prefers the front cover over a fallback', async () => {
    const cover = new Uint8Array([1, 2, 3, 4]);
    const file = new File([concatenate(encoder.encode('fLaC'), block(6, picture(4, new Uint8Array([9]))),
      block(1, new Uint8Array(2 * 1024 * 1024)), block(6, picture(3, cover), true)),
      new Uint8Array(8 * 1024 * 1024)], 'cover.flac');
    const io = reads(file);
    const artwork = await loadEmbeddedStreamArtwork(track(file));
    expect(artwork).toMatchObject({ width: 500, height: 500 });
    expect(new Uint8Array(await artwork!.blob.arrayBuffer())).toEqual(cover);
    expect(io.full).not.toHaveBeenCalled();
    expect(io.total()).toBeLessThan(1024);
  });

  it('reads continued OpusTags pages while skipping unrelated large comments and audio', async () => {
    const cover = new Uint8Array(6000).fill(7);
    const encoded = btoa(String.fromCharCode(...picture(3, cover)));
    const tags = opusComments([encoder.encode(`LYRICS=${'x'.repeat(2 * 1024 * 1024)}`),
      encoder.encode(`METADATA_BLOCK_PICTURE=${encoded}`)]);
    const file = new File([ogg([encoder.encode('OpusHead'), tags]), new Uint8Array(8 * 1024 * 1024)], 'cover.opus');
    const io = reads(file);
    const artwork = await loadEmbeddedStreamArtwork(track(file));
    expect(new Uint8Array(await artwork!.blob.arrayBuffer())).toEqual(cover);
    expect(io.full).not.toHaveBeenCalled();
    expect(io.total()).toBeLessThan(40 * 1024);
  });

  it('reads pictures starting partway through small continued OpusTags pages', async () => {
    const cover = new Uint8Array(6000).fill(7);
    const encoded = btoa(String.fromCharCode(...picture(3, cover)));
    const tags = opusComments([encoder.encode(`LYRICS=${'x'.repeat(5000)}`),
      encoder.encode(`METADATA_BLOCK_PICTURE=${encoded}`)]);
    const file = new File([ogg([encoder.encode('OpusHead'), tags], 32)], 'small-pages.opus');
    const artwork = await loadEmbeddedStreamArtwork(track(file));
    expect(artwork).not.toBeNull();
    expect(new Uint8Array(await artwork!.blob.arrayBuffer())).toEqual(cover);
  });

  it('handles truncated pictures and malformed page lengths without reading the whole file', async () => {
    const brokenPicture = concatenate(uint32(3), uint32(24), new Uint8Array(24));
    const flac = new File([encoder.encode('fLaC'), block(6, brokenPicture, true)], 'broken.flac');
    const io = reads(flac);
    await expect(loadEmbeddedStreamArtwork(track(flac))).resolves.toBeNull();
    expect(io.full).not.toHaveBeenCalled();
    const truncated = ogg([encoder.encode('OpusHead'), opusComments([encoder.encode('METADATA_BLOCK_PICTURE=invalid')])]);
    const opus = new File([truncated.subarray(0, truncated.length - 8)], 'broken.opus');
    await expect(loadEmbeddedStreamArtwork(track(opus))).resolves.toBeNull();
  });
});

describe('ranged embedded lyrics', () => {
  it.each(['flac', 'opus', 'ogg'])('reads %s lyrics without loading artwork or audio and preserves key priority', async (extension) => {
    const raw = '[00:01.00]First line\n[00:02.00]Second line';
    const comments = opusComments([
      encoder.encode('SYNCEDLYRICS=[00:01.00]Fallback'),
      encoder.encode(`METADATA_BLOCK_PICTURE=${'x'.repeat(2 * 1024 * 1024)}`),
      encoder.encode(`LYRICS=${raw}`)
    ]).subarray(8);
    const data = extension === 'flac'
      ? concatenate(encoder.encode('fLaC'), block(4, comments, true))
      : ogg([encoder.encode(extension === 'opus' ? 'OpusHead' : 'vorbis'),
        concatenate(extension === 'opus' ? encoder.encode('OpusTags') : new Uint8Array([3, ...encoder.encode('vorbis')]), comments)]);
    const file = new File([data, new Uint8Array(8 * 1024 * 1024)], `lyrics.${extension}`);
    const io = reads(file);
    expect(await loadTrackLyrics(track(file))).toMatchObject({ raw, source: 'vorbis-comments', lines: [{ time: 1, text: 'First line' }, { time: 2, text: 'Second line' }] });
    expect(io.full).not.toHaveBeenCalled();
    expect(io.total()).toBeLessThan(40 * 1024);
  });

  it('skips oversized lyric comments and absent lyrics without falling through to another artwork parser', async () => {
    const comments = opusComments([encoder.encode(`LYRICS=${'x'.repeat(2 * 1024 * 1024)}`)]).subarray(8);
    const file = new File([encoder.encode('fLaC'), block(4, comments, true), new Uint8Array(8 * 1024 * 1024)], 'oversized-lyrics.flac');
    const io = reads(file);
    await expect(loadTrackLyrics(track(file))).resolves.toBeNull();
    expect(io.full).not.toHaveBeenCalled();
    expect(io.total()).toBeLessThan(8192);
  });
});
