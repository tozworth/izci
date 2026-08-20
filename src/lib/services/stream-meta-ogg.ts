import type { TrackMetadata } from '$lib/types';

import { concatUint8Arrays, readUint24BE } from './stream-meta-binary';
import { FileRangeReader } from './stream-meta-io';
import {
  applyVorbisComment,
  parseVorbisCommentsPacket,
  readVorbisCommentsPacket,
  type ParsedStreamData,
  type VorbisComment
} from './stream-meta-flac';
export { readVorbisCommentsPacket } from './stream-meta-flac';

export const FLAC_MARKER = 'fLaC';
export const OPUS_TAGS_MARKER = 'OpusTags';
export const VORBIS_PACKET_MARKER = 'vorbis';
export const METADATA_BLOCK_PICTURE_KEY = 'METADATA_BLOCK_PICTURE';

export function extractStreamVorbisComments(bytes: Uint8Array, extension: string): VorbisComment[] {
  if (extension === 'flac') {
    return extractFlacVorbisComments(bytes);
  }

  if (extension === 'opus') {
    const packet = extractOpusTagPacket(bytes);

    if (!packet || packet.byteLength < 16) {
      return [];
    }

    const marker = new TextDecoder().decode(packet.subarray(0, 8));
    return marker === OPUS_TAGS_MARKER ? readVorbisCommentsPacket(packet, 8) : [];
  }

  if (extension === 'ogg') {
    const packet = extractOggVorbisCommentPacket(bytes);

    return packet ? readVorbisCommentsPacket(packet, 7) : [];
  }

  return [];
}

function extractFlacVorbisComments(bytes: Uint8Array): VorbisComment[] {
  if (bytes.byteLength < 4 || new TextDecoder().decode(bytes.subarray(0, 4)) !== FLAC_MARKER) {
    return [];
  }

  const comments: VorbisComment[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 4;

  while (offset + 4 <= bytes.byteLength) {
    const header = view.getUint8(offset);
    const isLastBlock = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockLength = readUint24BE(view, offset + 1);
    const blockStart = offset + 4;
    const blockEnd = blockStart + blockLength;

    if (blockEnd > bytes.byteLength) {
      return comments;
    }

    if (blockType === 4) {
      comments.push(...readVorbisCommentsPacket(bytes.subarray(blockStart, blockEnd), 0));
    }

    offset = blockEnd;

    if (isLastBlock) {
      break;
    }
  }

  return comments;
}

export function parseOpusData(bytes: Uint8Array): ParsedStreamData {
  const metadata: TrackMetadata = {};
  const packet = extractOpusTagPacket(bytes);

  if (!packet || packet.byteLength < 16) {
    return { metadata, artwork: null };
  }

  const marker = new TextDecoder().decode(packet.subarray(0, 8));

  if (marker !== OPUS_TAGS_MARKER) {
    return { metadata, artwork: null };
  }

  return parseVorbisCommentsPacket(packet, 8);
}

export function parseOggVorbisData(bytes: Uint8Array): ParsedStreamData {
  const packet = extractOggVorbisCommentPacket(bytes);

  if (!packet) {
    return {
      metadata: {},
      artwork: null
    };
  }

  return parseVorbisCommentsPacket(packet, 7);
}

export function extractOggPacket(bytes: Uint8Array, targetPacketIndex: number): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let activeStreamSerial: number | null = null;
  let currentPacket: number[] = [];
  let packetCount = 0;

  while (offset + 27 <= bytes.byteLength) {
    if (
      bytes[offset] !== 0x4f ||
      bytes[offset + 1] !== 0x67 ||
      bytes[offset + 2] !== 0x67 ||
      bytes[offset + 3] !== 0x53
    ) {
      return null;
    }

    const pageSegments = view.getUint8(offset + 26);
    const segmentTableOffset = offset + 27;
    const segmentTableEnd = segmentTableOffset + pageSegments;

    if (segmentTableEnd > bytes.byteLength) {
      return null;
    }

    const pageDataOffset = segmentTableEnd;
    let pageDataLength = 0;

    for (let index = 0; index < pageSegments; index += 1) {
      pageDataLength += view.getUint8(segmentTableOffset + index);
    }

    const pageDataEnd = pageDataOffset + pageDataLength;

    if (pageDataEnd > bytes.byteLength) {
      return null;
    }

    const streamSerial = view.getUint32(offset + 14, true);

    if (activeStreamSerial === null) {
      activeStreamSerial = streamSerial;
    }

    if (streamSerial === activeStreamSerial) {
      let cursor = pageDataOffset;

      for (let index = 0; index < pageSegments; index += 1) {
        const segmentLength = view.getUint8(segmentTableOffset + index);

        for (let segmentOffset = 0; segmentOffset < segmentLength; segmentOffset += 1) {
          currentPacket.push(bytes[cursor + segmentOffset]);
        }

        cursor += segmentLength;

        if (segmentLength < 255) {
          const packet = new Uint8Array(currentPacket);

          if (packetCount === targetPacketIndex) {
            return packet;
          }

          packetCount += 1;
          currentPacket = [];
        }
      }
    }

    offset = pageDataEnd;
  }

  return null;
}

export function extractOpusTagPacket(bytes: Uint8Array): Uint8Array | null {
  return extractOggPacket(bytes, 1);
}

export function extractOggVorbisCommentPacket(bytes: Uint8Array): Uint8Array | null {
  const packet = extractOggPacket(bytes, 1);

  if (!packet || packet.byteLength < 7) {
    return null;
  }

  const packetType = packet[0];
  const marker = new TextDecoder().decode(packet.subarray(1, 7));

  return packetType === 0x03 && marker === VORBIS_PACKET_MARKER ? packet : null;
}

export function readOggMetadata(
  file: File,
  extension: 'opus' | 'ogg',
  options: {
    readBytes(offset: number, length: number): Promise<Uint8Array>;
    eagerHeadBytes: number;
    scanLimitBytes: number;
    durationTailBytes: number;
    commentKeyProbeBytes: number;
    textCommentLimitBytes: number;
  }
): Promise<TrackMetadata> {
  return readOggMetadataImpl(file, extension, options);
}

async function readOggMetadataImpl(
  file: File,
  extension: 'opus' | 'ogg',
  options: {
    readBytes(offset: number, length: number): Promise<Uint8Array>;
    eagerHeadBytes: number;
    scanLimitBytes: number;
    durationTailBytes: number;
    commentKeyProbeBytes: number;
    textCommentLimitBytes: number;
  }
): Promise<TrackMetadata> {
  const head = await options.readBytes(0, Math.min(file.size, options.eagerHeadBytes));
  const eagerTagsPacket = extension === 'opus'
    ? extractOpusTagPacket(head)
    : extractOggVorbisCommentPacket(head);
  let metadata: TrackMetadata;

  if (eagerTagsPacket) {
    metadata = parseVorbisCommentsPacket(eagerTagsPacket, extension === 'opus' ? 8 : 7).metadata;
  } else {
    const tagsPacket = await findOggPacketRanges(file, 1, options);
    if (!tagsPacket) return {};

    const prefix = extension === 'opus'
      ? new TextEncoder().encode(OPUS_TAGS_MARKER)
      : concatUint8Arrays(new Uint8Array([0x03]), new TextEncoder().encode(VORBIS_PACKET_MARKER));
    metadata = await readVorbisMetadata(file, tagsPacket.ranges, prefix, options);
  }

  const eagerIdentification = extractOggPacket(head, 0);
  let identification = eagerIdentification?.subarray(0, extension === 'opus' ? 12 : 16) ?? null;
  let streamSerial = head.byteLength >= 18
    ? new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(14, true)
    : null;

  if (!identification || streamSerial === null) {
    const identificationPacket = await findOggPacketRanges(file, 0, options);
    if (!identificationPacket) return metadata;

    const identificationReader = new FileRangeReader(file, identificationPacket.ranges, options.readBytes);
    identification = await identificationReader.read(extension === 'opus' ? 12 : 16);
    streamSerial = identificationPacket.streamSerial;
  }

  const granule = await readLastOggGranule(file, streamSerial, options);

  if (!identification || granule === null) return metadata;

  if (
    extension === 'opus' &&
    identification.byteLength >= 12 &&
    new TextDecoder().decode(identification.subarray(0, 8)) === 'OpusHead'
  ) {
    const preSkip = new DataView(identification.buffer, identification.byteOffset, identification.byteLength).getUint16(10, true);
    const samples = granule - BigInt(preSkip);
    if (samples > 0n) metadata.duration = Number(samples) / 48_000;
  }

  if (
    extension === 'ogg' &&
    identification.byteLength >= 16 &&
    identification[0] === 0x01 &&
    new TextDecoder().decode(identification.subarray(1, 7)) === VORBIS_PACKET_MARKER
  ) {
    const sampleRate = new DataView(identification.buffer, identification.byteOffset, identification.byteLength).getUint32(12, true);
    if (sampleRate > 0 && granule > 0n) metadata.duration = Number(granule) / sampleRate;
  }

  return metadata;
}

export async function findOggPacketRanges(
  file: File,
  targetPacketIndex: number,
  options: { readBytes(offset: number, length: number): Promise<Uint8Array>; scanLimitBytes: number }
): Promise<{
  ranges: Array<{ offset: number; length: number }>;
  streamSerial: number;
} | null> {
  let offset = 0;
  let activeStreamSerial: number | null = null;
  let packetIndex = 0;
  const ranges: Array<{ offset: number; length: number }> = [];

  while (offset + 27 <= file.size && offset < options.scanLimitBytes) {
    const header = await options.readBytes(offset, 27);
    if (
      header.byteLength !== 27 ||
      header[0] !== 0x4f ||
      header[1] !== 0x67 ||
      header[2] !== 0x67 ||
      header[3] !== 0x53
    ) {
      return null;
    }

    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const pageSegments = header[26];
    const segmentTable = await options.readBytes(offset + 27, pageSegments);
    if (segmentTable.byteLength !== pageSegments) return null;

    const streamSerial = view.getUint32(14, true);
    activeStreamSerial ??= streamSerial;
    let pageDataOffset = offset + 27 + pageSegments;

    if (streamSerial === activeStreamSerial) {
      for (const segmentLength of segmentTable) {
        if (packetIndex === targetPacketIndex && segmentLength > 0) {
          ranges.push({ offset: pageDataOffset, length: segmentLength });
        }

        pageDataOffset += segmentLength;

        if (segmentLength < 255) {
          if (packetIndex === targetPacketIndex) {
            return { ranges, streamSerial: activeStreamSerial };
          }
          packetIndex += 1;
        }
      }
    } else {
      pageDataOffset += segmentTable.reduce((total, length) => total + length, 0);
    }

    offset = pageDataOffset;
  }

  return null;
}

export async function readLastOggGranule(
  file: File,
  streamSerial: number,
  options: { readBytes(offset: number, length: number): Promise<Uint8Array>; durationTailBytes: number }
): Promise<bigint | null> {
  const tailLength = Math.min(file.size, options.durationTailBytes);
  const tailOffset = file.size - tailLength;
  const tail = await options.readBytes(tailOffset, tailLength);

  for (let offset = tail.byteLength - 27; offset >= 0; offset -= 1) {
    if (
      tail[offset] !== 0x4f ||
      tail[offset + 1] !== 0x67 ||
      tail[offset + 2] !== 0x67 ||
      tail[offset + 3] !== 0x53 ||
      tail[offset + 4] !== 0
    ) {
      continue;
    }

    const view = new DataView(tail.buffer, tail.byteOffset + offset, 27);
    if (view.getUint32(14, true) !== streamSerial) continue;

    const pageSegments = tail[offset + 26];
    const segmentTableEnd = offset + 27 + pageSegments;
    if (segmentTableEnd > tail.byteLength) continue;

    let pageEnd = segmentTableEnd;
    for (let index = offset + 27; index < segmentTableEnd; index += 1) pageEnd += tail[index];
    if (pageEnd > tail.byteLength) continue;

    const low = BigInt(view.getUint32(6, true));
    const high = BigInt(view.getUint32(10, true));
    const granule = (high << 32n) | low;
    return granule === 0xffffffffffffffffn ? null : granule;
  }

  return null;
}

async function readVorbisMetadata(
  file: File,
  ranges: Array<{ offset: number; length: number }>,
  expectedPrefix: Uint8Array,
  options: {
    readBytes(offset: number, length: number): Promise<Uint8Array>;
    commentKeyProbeBytes: number;
    textCommentLimitBytes: number;
  }
): Promise<TrackMetadata> {
  const reader = new FileRangeReader(file, ranges, options.readBytes);

  if (expectedPrefix) {
    const prefix = await reader.read(expectedPrefix.byteLength);
    if (!prefix || prefix.some((value, index) => value !== expectedPrefix[index])) return {};
  }

  const vendorLength = await reader.readUint32LE();
  if (vendorLength === null || !reader.skip(vendorLength)) return {};

  const commentCount = await reader.readUint32LE();
  if (commentCount === null) return {};

  const metadata: TrackMetadata = {};

  for (let index = 0; index < commentCount && reader.remaining >= 4; index += 1) {
    const commentLength = await reader.readUint32LE();
    if (commentLength === null || commentLength > reader.remaining) break;

    const probeLength = Math.min(commentLength, options.commentKeyProbeBytes);
    const probe = await reader.read(probeLength);
    if (!probe) break;

    const separatorIndex = probe.indexOf(0x3d);
    const remainingCommentLength = commentLength - probeLength;

    if (separatorIndex <= 0) {
      reader.skip(remainingCommentLength);
      continue;
    }

    const key = new TextDecoder().decode(probe.subarray(0, separatorIndex)).trim();

    if (key.toUpperCase() === METADATA_BLOCK_PICTURE_KEY) {
      reader.skip(remainingCommentLength);
      continue;
    }

    if (commentLength > options.textCommentLimitBytes) {
      reader.skip(remainingCommentLength);
      continue;
    }

    const remainder = await reader.read(remainingCommentLength);
    if (!remainder) break;

    const valueBytes = concatUint8Arrays(probe.subarray(separatorIndex + 1), remainder);
    applyVorbisComment(metadata, key, new TextDecoder().decode(valueBytes));
  }

  return metadata;
}
