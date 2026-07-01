import { describe, expect, it } from 'vitest';

import { getTrackArtworkLoadKey, loadTrackMetadata } from './stream-artwork';
import type { PlaylistItem } from '$lib/types';

const textEncoder = new TextEncoder();

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function uint32LE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function vorbisCommentPacket(comments: string[]): Uint8Array {
  const vendor = textEncoder.encode('izci-test');
  const encodedComments = comments.map((comment) => textEncoder.encode(comment));
  const commentChunks = encodedComments.flatMap((comment) => [uint32LE(comment.byteLength), comment]);

  return concatBytes(uint32LE(vendor.byteLength), vendor, uint32LE(encodedComments.length), ...commentChunks);
}

function flacFile(comments: string[]): File {
  const block = vorbisCommentPacket(comments);
  const header = new Uint8Array([
    0x80 | 4,
    (block.byteLength >> 16) & 0xff,
    (block.byteLength >> 8) & 0xff,
    block.byteLength & 0xff
  ]);

  return new File([toArrayBuffer(concatBytes(textEncoder.encode('fLaC'), header, block))], 'Tagged.flac', {
    type: 'audio/flac'
  });
}

function oggPage(packets: Uint8Array[]): Uint8Array {
  const header = new Uint8Array(27);
  header.set(textEncoder.encode('OggS'), 0);
  header[26] = packets.length;
  new DataView(header.buffer).setUint32(14, 1, true);

  return concatBytes(header, new Uint8Array(packets.map((packet) => packet.byteLength)), ...packets);
}

function opusFile(comments: string[]): File {
  const opusHead = textEncoder.encode('OpusHead');
  const opusTags = concatBytes(textEncoder.encode('OpusTags'), vorbisCommentPacket(comments));

  return new File([toArrayBuffer(oggPage([opusHead, opusTags]))], 'Tagged.opus', {
    type: 'audio/opus'
  });
}

function item(overrides: Partial<PlaylistItem>): PlaylistItem {
  return {
    id: 'track-id',
    name: 'Tagged.flac',
    extension: 'flac',
    kind: 'stream',
    size: 1,
    lastModified: 1,
    ...overrides
  };
}

describe('stream artwork metadata helpers', () => {
  it('uses stable item ids as artwork load keys', () => {
    expect(getTrackArtworkLoadKey(null)).toBe('');
    expect(getTrackArtworkLoadKey(item({ id: 'stable-id' }))).toBe('stable-id');
  });

  it('loads textual metadata from FLAC Vorbis comments', async () => {
    const metadata = await loadTrackMetadata(
      item({
        file: flacFile([
          'TITLE=  Night Walk  ',
          'ARTIST=Izci',
          'ALBUM=Local First',
          'ALBUMARTIST=Various Artists',
          'GENRE=Tracker',
          'DATE=Recorded 2024-05-01',
          'TRACKNUMBER=3/9',
          'DISCNUMBER=1',
          'COMPOSER=Module Writer'
        ])
      })
    );

    expect(metadata).toEqual({
      title: 'Night Walk',
      artist: 'Izci',
      album: 'Local First',
      albumArtist: 'Various Artists',
      genre: 'Tracker',
      year: '2024',
      trackNumber: '3/9',
      discNumber: '1',
      composer: 'Module Writer',
      embeddedMetadataLoaded: true
    });
  });

  it('loads textual metadata from OpusTags packets', async () => {
    const metadata = await loadTrackMetadata(
      item({
        name: 'Tagged.opus',
        extension: 'opus',
        file: opusFile(['TITLE=Opus Tune', 'ARTIST=Local Artist', 'YEAR=1998'])
      })
    );

    expect(metadata).toEqual({
      title: 'Opus Tune',
      artist: 'Local Artist',
      year: '1998',
      embeddedMetadataLoaded: true
    });
  });

  it('returns null for formats without embedded stream metadata support', async () => {
    await expect(loadTrackMetadata(item({ extension: 'mp3', file: new File([], 'Track.mp3') }))).resolves.toBeNull();
    await expect(loadTrackMetadata(item({ extension: 'xm', kind: 'module', file: new File([], 'Track.xm') }))).resolves.toBeNull();
  });
});
