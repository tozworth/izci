import type { TrackMetadata } from '$lib/types';

import { readUint24BE, decodeBase64, concatUint8Arrays } from './stream-meta-binary';
import { FileRangeReader } from './stream-meta-io';
import { applyReplayGainComment } from './stream-meta-replaygain';

const FLAC_VORBIS_COMMENT_BLOCK_TYPE = 4;
const FLAC_PICTURE_BLOCK_TYPE = 6;
const METADATA_BLOCK_PICTURE_KEY = 'METADATA_BLOCK_PICTURE';

const FLAC_MARKER = 'fLaC';

interface ParsedArtwork {
  mimeType: string;
  data: Uint8Array;
  width?: number;
  height?: number;
  pictureType?: number;
}

interface ParsedVorbisComments {
  metadata: TrackMetadata;
  artwork: ParsedArtwork | null;
}

export interface ParsedStreamData {
  metadata: TrackMetadata;
  artwork: ParsedArtwork | null;
}

export interface VorbisComment {
  key: string;
  value: string;
}

function trimTagValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeYearTagValue(value: string): string | undefined {
  const normalizedValue = trimTagValue(value);

  if (!normalizedValue) {
    return undefined;
  }

  const yearMatch = normalizedValue.match(/\b\d{4}\b/);
  return yearMatch ? yearMatch[0] : normalizedValue;
}

export function applyVorbisComment(metadata: TrackMetadata, key: string, value: string): void {
  const normalizedValue = trimTagValue(value);

  if (!normalizedValue) {
    return;
  }

  if (applyReplayGainComment(metadata, key, normalizedValue)) {
    return;
  }

  switch (key.trim().toUpperCase()) {
    case 'TITLE':
      metadata.title ??= normalizedValue;
      break;
    case 'ARTIST':
      metadata.artist ??= normalizedValue;
      break;
    case 'ALBUM':
      metadata.album ??= normalizedValue;
      break;
    case 'ALBUMARTIST':
    case 'ALBUM ARTIST':
      metadata.albumArtist ??= normalizedValue;
      break;
    case 'GENRE':
      metadata.genre ??= normalizedValue;
      break;
    case 'DATE':
    case 'YEAR':
      metadata.year ??= normalizeYearTagValue(normalizedValue);
      break;
    case 'TRACKNUMBER':
      metadata.trackNumber ??= normalizedValue;
      break;
    case 'DISCNUMBER':
    case 'DISC':
      metadata.discNumber ??= normalizedValue;
      break;
    case 'COMPOSER':
      metadata.composer ??= normalizedValue;
      break;
    default:
      break;
  }
}

function parsePictureBlock(block: Uint8Array): ParsedArtwork | null {
  if (block.byteLength < 32) {
    return null;
  }

  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  let offset = 0;

  const pictureType = view.getUint32(offset);
  offset += 4;

  const mimeLength = view.getUint32(offset);
  offset += 4;

  if (offset + mimeLength > block.byteLength) {
    return null;
  }

  const mimeType = new TextDecoder().decode(block.subarray(offset, offset + mimeLength)).trim();
  offset += mimeLength;

  const descriptionLength = view.getUint32(offset);
  offset += 4 + descriptionLength;

  if (offset + 20 > block.byteLength) {
    return null;
  }

  const width = view.getUint32(offset);
  offset += 4;
  const height = view.getUint32(offset);
  offset += 4;

  offset += 8;

  const dataLength = view.getUint32(offset);
  offset += 4;

  if (offset + dataLength > block.byteLength) {
    return null;
  }

  return {
    mimeType: mimeType || 'application/octet-stream',
    data: block.slice(offset, offset + dataLength),
    width: width > 0 ? width : undefined,
    height: height > 0 ? height : undefined,
    pictureType
  };
}

export function readVorbisCommentsPacket(packet: Uint8Array, offset: number): VorbisComment[] {
  const comments: VorbisComment[] = [];
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

  if (offset + 4 > packet.byteLength) {
    return comments;
  }

  const vendorLength = view.getUint32(offset, true);
  offset += 4 + vendorLength;

  if (offset + 4 > packet.byteLength) {
    return comments;
  }

  const commentCount = view.getUint32(offset, true);
  offset += 4;

  for (let index = 0; index < commentCount; index += 1) {
    if (offset + 4 > packet.byteLength) {
      break;
    }

    const commentLength = view.getUint32(offset, true);
    offset += 4;

    if (offset + commentLength > packet.byteLength) {
      break;
    }

    const comment = new TextDecoder().decode(packet.subarray(offset, offset + commentLength));
    offset += commentLength;

    const separatorIndex = comment.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = comment.slice(0, separatorIndex).trim();
    const value = comment.slice(separatorIndex + 1);

    comments.push({ key, value });
  }

  return comments;
}

export function parseVorbisCommentsPacket(packet: Uint8Array, offset: number): ParsedVorbisComments {
  const metadata: TrackMetadata = {};
  let artwork: ParsedArtwork | null = null;

  for (const { key, value } of readVorbisCommentsPacket(packet, offset)) {
    if (key.toUpperCase() === METADATA_BLOCK_PICTURE_KEY) {
      const pictureBytes = decodeBase64(value.trim());
      artwork ??= pictureBytes ? parsePictureBlock(pictureBytes) : null;
      continue;
    }

    applyVorbisComment(metadata, key, value);
  }

  return { metadata, artwork };
}

export function parseFlacData(bytes: Uint8Array): ParsedStreamData {
  const metadata: TrackMetadata = {};

  if (bytes.byteLength < 4 || new TextDecoder().decode(bytes.subarray(0, 4)) !== FLAC_MARKER) {
    return { metadata, artwork: null };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 4;
  let preferredArtwork: ParsedArtwork | null = null;
  let fallbackArtwork: ParsedArtwork | null = null;

  while (offset + 4 <= bytes.byteLength) {
    const header = view.getUint8(offset);
    const isLastBlock = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockLength = readUint24BE(view, offset + 1);
    const blockStart = offset + 4;
    const blockEnd = blockStart + blockLength;

    if (blockEnd > bytes.byteLength) {
      return {
        metadata,
        artwork: preferredArtwork ?? fallbackArtwork
      };
    }

    if (blockType === FLAC_VORBIS_COMMENT_BLOCK_TYPE) {
      Object.assign(metadata, parseVorbisCommentsPacket(bytes.subarray(blockStart, blockEnd), 0).metadata);
    }

    if (blockType === FLAC_PICTURE_BLOCK_TYPE) {
      const artwork = parsePictureBlock(bytes.subarray(blockStart, blockEnd));

      if (artwork) {
        if (artwork.pictureType === 3) {
          preferredArtwork ??= artwork;
        } else {
          fallbackArtwork ??= artwork;
        }
      }
    }

    offset = blockEnd;

    if (isLastBlock) {
      break;
    }
  }

  return {
    metadata,
    artwork: preferredArtwork ?? fallbackArtwork
  };
}

export function readFlacMetadata(
  file: File,
  options: { readBytes(offset: number, length: number): Promise<Uint8Array>; maxHeadBytes: number; eagerHeadBytes: number; commentKeyProbeBytes?: number; textCommentLimitBytes?: number }
): Promise<TrackMetadata> {
  return readFlacMetadataImpl(file, options);
}

async function readFlacMetadataImpl(
  file: File,
  options: { readBytes(offset: number, length: number): Promise<Uint8Array>; maxHeadBytes: number; eagerHeadBytes: number; commentKeyProbeBytes?: number; textCommentLimitBytes?: number }
): Promise<TrackMetadata> {
  const marker = await options.readBytes(0, 4);
  if (new TextDecoder().decode(marker) !== FLAC_MARKER) return {};

  const metadata: TrackMetadata = {};
  let offset = 4;

  while (offset + 4 <= file.size && offset < options.maxHeadBytes) {
    const header = await options.readBytes(offset, 4);
    if (header.byteLength !== 4) break;

    const isLastBlock = (header[0] & 0x80) !== 0;
    const blockType = header[0] & 0x7f;
    const blockLength = (header[1] << 16) | (header[2] << 8) | header[3];
    const blockOffset = offset + 4;

    if (blockOffset + blockLength > file.size) break;

    if (blockType === 0 && blockLength >= 18) {
      const streamInfo = await options.readBytes(blockOffset, Math.min(blockLength, 34));
      if (streamInfo.byteLength >= 18) {
        const sampleRate = (streamInfo[10] << 12) | (streamInfo[11] << 4) | (streamInfo[12] >> 4);
        const totalSamples =
          (BigInt(streamInfo[13] & 0x0f) << 32n) |
          (BigInt(streamInfo[14]) << 24n) |
          (BigInt(streamInfo[15]) << 16n) |
          (BigInt(streamInfo[16]) << 8n) |
          BigInt(streamInfo[17]);
        if (sampleRate > 0 && totalSamples > 0n) metadata.duration = Number(totalSamples) / sampleRate;
      }
    }

    if (blockType === FLAC_VORBIS_COMMENT_BLOCK_TYPE) {
      if (blockLength <= options.eagerHeadBytes) {
        const comments = await options.readBytes(blockOffset, blockLength);
        Object.assign(metadata, parseVorbisCommentsPacket(comments, 0).metadata);
      } else {
        Object.assign(
          metadata,
          await readVorbisMetadata([{ offset: blockOffset, length: blockLength }], {
            readBytes: options.readBytes,
            commentKeyProbeBytes: options.commentKeyProbeBytes ?? 512,
            textCommentLimitBytes: options.textCommentLimitBytes ?? 256 * 1024
          })
        );
      }
    }

    offset = blockOffset + blockLength;
    if (isLastBlock) break;
  }

  return metadata;
}

async function readVorbisMetadata(
  ranges: Array<{ offset: number; length: number }>,
  options: { readBytes(offset: number, length: number): Promise<Uint8Array>; commentKeyProbeBytes: number; textCommentLimitBytes: number }
): Promise<TrackMetadata> {
  const reader = new FileRangeReader(ranges, options.readBytes);

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
