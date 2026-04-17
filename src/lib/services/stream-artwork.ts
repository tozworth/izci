import type { PlaylistItem, TrackMetadata } from '$lib/types';

const FLAC_MARKER = 'fLaC';
const OPUS_TAGS_MARKER = 'OpusTags';
const METADATA_BLOCK_PICTURE_KEY = 'METADATA_BLOCK_PICTURE';
const FLAC_VORBIS_COMMENT_BLOCK_TYPE = 4;
const FLAC_PICTURE_BLOCK_TYPE = 6;

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

interface ParsedStreamData {
  metadata: TrackMetadata;
  artwork: ParsedArtwork | null;
}

export interface LoadedStreamArtwork {
  url: string;
  mediaImage: MediaImage;
}

function readUint24BE(view: DataView, offset: number): number {
  return (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2);
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const decoded = atob(value);
    const bytes = new Uint8Array(decoded.length);

    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }

    return bytes;
  } catch {
    return null;
  }
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

function applyVorbisComment(metadata: TrackMetadata, key: string, value: string): void {
  const normalizedValue = trimTagValue(value);

  if (!normalizedValue) {
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

function parseVorbisCommentsPacket(packet: Uint8Array, offset: number): ParsedVorbisComments {
  const metadata: TrackMetadata = {};
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  let artwork: ParsedArtwork | null = null;

  if (offset + 4 > packet.byteLength) {
    return { metadata, artwork };
  }

  const vendorLength = view.getUint32(offset, true);
  offset += 4 + vendorLength;

  if (offset + 4 > packet.byteLength) {
    return { metadata, artwork };
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

    if (key.toUpperCase() === METADATA_BLOCK_PICTURE_KEY) {
      const pictureBytes = decodeBase64(value.trim());
      artwork ??= pictureBytes ? parsePictureBlock(pictureBytes) : null;
      continue;
    }

    applyVorbisComment(metadata, key, value);
  }

  return { metadata, artwork };
}

function parseFlacData(bytes: Uint8Array): ParsedStreamData {
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

function extractOpusTagPacket(bytes: Uint8Array): Uint8Array | null {
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
          packetCount += 1;

          if (packetCount === 2) {
            return new Uint8Array(currentPacket);
          }

          currentPacket = [];
        }
      }
    }

    offset = pageDataEnd;
  }

  return null;
}

function parseOpusData(bytes: Uint8Array): ParsedStreamData {
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

async function resolveTrackFile(track: PlaylistItem): Promise<File | null> {
  if (track.fileHandle) {
    try {
      return await track.fileHandle.getFile();
    } catch {
      // Fall back to the in-memory File when permission is unavailable or stale.
    }
  }

  return track.file ?? null;
}

function buildMediaImage(artwork: ParsedArtwork, url: string): MediaImage {
  return {
    src: url,
    type: artwork.mimeType || undefined,
    sizes: artwork.width && artwork.height ? `${artwork.width}x${artwork.height}` : undefined
  };
}

function extractStreamData(bytes: Uint8Array, extension: string): ParsedStreamData {
  if (extension === 'flac') {
    return parseFlacData(bytes);
  }

  if (extension === 'opus') {
    return parseOpusData(bytes);
  }

  return {
    metadata: {},
    artwork: null
  };
}

function extractArtwork(bytes: Uint8Array, extension: string): ParsedArtwork | null {
  return extractStreamData(bytes, extension).artwork;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function getTrackArtworkLoadKey(track: PlaylistItem | null): string {
  if (!track) {
    return '';
  }

  return [
    track.id,
    track.kind,
    track.extension,
    track.file ? 'file' : 'no-file',
    track.fileHandle ? 'handle' : 'no-handle',
    track.size,
    track.lastModified
  ].join(':');
}

export async function loadTrackMetadata(track: PlaylistItem | null): Promise<TrackMetadata | null> {
  if (!track || track.kind !== 'stream' || (track.extension !== 'flac' && track.extension !== 'opus')) {
    return null;
  }

  const file = await resolveTrackFile(track);

  if (!file) {
    return null;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const metadata: TrackMetadata = {
    ...extractStreamData(bytes, track.extension).metadata,
    embeddedMetadataLoaded: true
  };

  return metadata;
}

export async function loadTrackArtwork(track: PlaylistItem | null): Promise<LoadedStreamArtwork | null> {
  if (!track || track.kind !== 'stream' || (track.extension !== 'flac' && track.extension !== 'opus')) {
    return null;
  }

  const file = await resolveTrackFile(track);

  if (!file) {
    return null;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const artwork = extractArtwork(bytes, track.extension);

  if (!artwork || artwork.data.byteLength === 0) {
    return null;
  }

  const url = URL.createObjectURL(new Blob([toArrayBuffer(artwork.data)], { type: artwork.mimeType }));

  return {
    url,
    mediaImage: buildMediaImage(artwork, url)
  };
}

export function revokeTrackArtwork(artwork: LoadedStreamArtwork | null | undefined): void {
  if (artwork?.url) {
    URL.revokeObjectURL(artwork.url);
  }
}
