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

function uint32BE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function synchsafeUint32(value: number): Uint8Array {
  return new Uint8Array([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f
  ]);
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

function oggVorbisFile(comments: string[]): File {
  const vorbisHead = concatBytes(new Uint8Array([0x01]), textEncoder.encode('vorbis'));
  const vorbisComments = concatBytes(new Uint8Array([0x03]), textEncoder.encode('vorbis'), vorbisCommentPacket(comments));

  return new File([toArrayBuffer(oggPage([vorbisHead, vorbisComments]))], 'Tagged.ogg', {
    type: 'audio/ogg'
  });
}

function id3UserTextFrame(description: string, value: string): Uint8Array {
  const frameData = concatBytes(new Uint8Array([3]), textEncoder.encode(`${description}\u0000${value}`));

  return concatBytes(textEncoder.encode('TXXX'), uint32BE(frameData.byteLength), new Uint8Array([0, 0]), frameData);
}

function mp3File(frames: Uint8Array[]): File {
  const tagData = concatBytes(...frames);
  const header = concatBytes(textEncoder.encode('ID3'), new Uint8Array([3, 0, 0]), synchsafeUint32(tagData.byteLength));

  return new File([toArrayBuffer(concatBytes(header, tagData, new Uint8Array([0xff, 0xfb, 0x90, 0x64])))], 'Tagged.mp3', {
    type: 'audio/mpeg'
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
          'COMPOSER=Module Writer',
          'REPLAYGAIN_TRACK_GAIN=-7.50 dB',
          'REPLAYGAIN_TRACK_PEAK=0.960000',
          'REPLAYGAIN_ALBUM_GAIN=-6.25 dB',
          'REPLAYGAIN_ALBUM_PEAK=0.980000'
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
      replayGain: {
        trackGainDb: -7.5,
        trackPeak: 0.96,
        albumGainDb: -6.25,
        albumPeak: 0.98
      },
      embeddedMetadataLoaded: true
    });
  });

  it('loads textual metadata from OpusTags packets', async () => {
    const metadata = await loadTrackMetadata(
      item({
        name: 'Tagged.opus',
        extension: 'opus',
        file: opusFile(['TITLE=Opus Tune', 'ARTIST=Local Artist', 'YEAR=1998', 'R128_TRACK_GAIN=-768'])
      })
    );

    expect(metadata).toEqual({
      title: 'Opus Tune',
      artist: 'Local Artist',
      year: '1998',
      replayGain: {
        trackGainDb: -3
      },
      embeddedMetadataLoaded: true
    });
  });

  it('loads ReplayGain metadata from Ogg Vorbis comments', async () => {
    const metadata = await loadTrackMetadata(
      item({
        name: 'Tagged.ogg',
        extension: 'ogg',
        file: oggVorbisFile(['REPLAYGAIN_TRACK_GAIN=+1.50 dB', 'REPLAYGAIN_ALBUM_GAIN=-2.25 dB'])
      })
    );

    expect(metadata).toEqual({
      replayGain: {
        trackGainDb: 1.5,
        albumGainDb: -2.25
      },
      embeddedMetadataLoaded: true
    });
  });

  it('loads ReplayGain metadata from MP3 ID3 user text frames', async () => {
    const metadata = await loadTrackMetadata(
      item({
        name: 'Tagged.mp3',
        extension: 'mp3',
        file: mp3File([
          id3UserTextFrame('replaygain_track_gain', '-5.25 dB'),
          id3UserTextFrame('replaygain_track_peak', '0.910000')
        ])
      })
    );

    expect(metadata).toEqual({
      replayGain: {
        trackGainDb: -5.25,
        trackPeak: 0.91
      },
      embeddedMetadataLoaded: true
    });
  });

  it('returns null for formats without embedded stream metadata support', async () => {
    await expect(loadTrackMetadata(item({ extension: 'wav', file: new File([], 'Track.wav') }))).resolves.toBeNull();
    await expect(loadTrackMetadata(item({ extension: 'xm', kind: 'module', file: new File([], 'Track.xm') }))).resolves.toBeNull();
  });
});
