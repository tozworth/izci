import type { PlaylistItem, ReplayGainMetadata, TrackMetadata } from '$lib/types';

const FLAC_MARKER = 'fLaC';
const ID3_MARKER = 'ID3';
const OPUS_TAGS_MARKER = 'OpusTags';
const VORBIS_PACKET_MARKER = 'vorbis';
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

export interface VorbisComment {
  key: string;
  value: string;
}

export interface LoadedStreamArtwork {
  url: string;
  mediaImage: MediaImage;
}

export interface EmbeddedStreamArtwork {
  blob: Blob;
  width?: number;
  height?: number;
}

function readUint24BE(view: DataView, offset: number): number {
  return (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2);
}

function readUint32BE(view: DataView, offset: number): number {
  return (
    (view.getUint8(offset) << 24) |
    (view.getUint8(offset + 1) << 16) |
    (view.getUint8(offset + 2) << 8) |
    view.getUint8(offset + 3)
  ) >>> 0;
}

function readSynchsafeUint32(view: DataView, offset: number): number {
  return (
    (view.getUint8(offset) << 21) |
    (view.getUint8(offset + 1) << 14) |
    (view.getUint8(offset + 2) << 7) |
    view.getUint8(offset + 3)
  );
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

function parseDecimalTagValue(value: string): number | undefined {
  const match = value.trim().match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);

  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeReplayGainDb(value: string): number | undefined {
  const parsed = parseDecimalTagValue(value);
  return parsed !== undefined && parsed >= -60 && parsed <= 60 ? parsed : undefined;
}

function normalizeReplayGainPeak(value: string): number | undefined {
  const parsed = parseDecimalTagValue(value);
  return parsed !== undefined && parsed > 0 && parsed <= 100 ? parsed : undefined;
}

function normalizeR128GainDb(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  const gainDb = Number.isFinite(parsed) ? parsed / 256 : undefined;

  return gainDb !== undefined && gainDb >= -60 && gainDb <= 60 ? gainDb : undefined;
}

function ensureReplayGain(metadata: TrackMetadata): ReplayGainMetadata {
  metadata.replayGain ??= {};
  return metadata.replayGain;
}

function assignReplayGainValue(
  replayGain: ReplayGainMetadata,
  key: keyof ReplayGainMetadata,
  value: number | undefined
): void {
  if (replayGain[key] === undefined && value !== undefined) {
    replayGain[key] = value;
  }
}

function applyReplayGainComment(metadata: TrackMetadata, key: string, value: string): boolean {
  const normalizedKey = key.trim().toUpperCase();
  const replayGain = ensureReplayGain(metadata);

  switch (normalizedKey) {
    case 'REPLAYGAIN_TRACK_GAIN':
      assignReplayGainValue(replayGain, 'trackGainDb', normalizeReplayGainDb(value));
      break;
    case 'REPLAYGAIN_ALBUM_GAIN':
      assignReplayGainValue(replayGain, 'albumGainDb', normalizeReplayGainDb(value));
      break;
    case 'REPLAYGAIN_TRACK_PEAK':
      assignReplayGainValue(replayGain, 'trackPeak', normalizeReplayGainPeak(value));
      break;
    case 'REPLAYGAIN_ALBUM_PEAK':
      assignReplayGainValue(replayGain, 'albumPeak', normalizeReplayGainPeak(value));
      break;
    case 'R128_TRACK_GAIN':
      assignReplayGainValue(replayGain, 'trackGainDb', normalizeR128GainDb(value));
      break;
    case 'R128_ALBUM_GAIN':
      assignReplayGainValue(replayGain, 'albumGainDb', normalizeR128GainDb(value));
      break;
    default:
      if (Object.keys(replayGain).length === 0) {
        delete metadata.replayGain;
      }
      return false;
  }

  if (Object.keys(replayGain).length === 0) {
    delete metadata.replayGain;
  }

  return true;
}

function applyVorbisComment(metadata: TrackMetadata, key: string, value: string): void {
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

function parseVorbisCommentsPacket(packet: Uint8Array, offset: number): ParsedVorbisComments {
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

export function extractStreamVorbisComments(bytes: Uint8Array, extension: string): VorbisComment[] {
  if (extension === 'flac') {
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

      if (blockType === FLAC_VORBIS_COMMENT_BLOCK_TYPE) {
        comments.push(...readVorbisCommentsPacket(bytes.subarray(blockStart, blockEnd), 0));
      }

      offset = blockEnd;

      if (isLastBlock) {
        break;
      }
    }

    return comments;
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

function extractOggPacket(bytes: Uint8Array, targetPacketIndex: number): Uint8Array | null {
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

function extractOpusTagPacket(bytes: Uint8Array): Uint8Array | null {
  return extractOggPacket(bytes, 1);
}

function extractOggVorbisCommentPacket(bytes: Uint8Array): Uint8Array | null {
  const packet = extractOggPacket(bytes, 1);

  if (!packet || packet.byteLength < 7) {
    return null;
  }

  const packetType = packet[0];
  const marker = new TextDecoder().decode(packet.subarray(1, 7));

  return packetType === 0x03 && marker === VORBIS_PACKET_MARKER ? packet : null;
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

function parseOggVorbisData(bytes: Uint8Array): ParsedStreamData {
  const packet = extractOggVorbisCommentPacket(bytes);

  if (!packet) {
    return {
      metadata: {},
      artwork: null
    };
  }

  return parseVorbisCommentsPacket(packet, 7);
}

function decodeTextBytes(bytes: Uint8Array, encoding: number): string {
  const labels: Record<number, string> = {
    0: 'iso-8859-1',
    1: 'utf-16',
    2: 'utf-16be',
    3: 'utf-8'
  };

  try {
    return new TextDecoder(labels[encoding] ?? 'iso-8859-1').decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function parseId3UserTextFrame(frameData: Uint8Array, metadata: TrackMetadata): void {
  if (frameData.byteLength < 2) {
    return;
  }

  const encoding = frameData[0];
  const text = decodeTextBytes(frameData.subarray(1), encoding);
  const parts = text.split(/\u0000+/);
  const key = parts[0]?.trim();
  const value = parts.slice(1).join('\u0000').trim();

  if (!key || !value) {
    return;
  }

  applyReplayGainComment(metadata, key, value);
}

function parseId3v2ReplayGain(bytes: Uint8Array, metadata: TrackMetadata): void {
  if (bytes.byteLength < 10 || new TextDecoder().decode(bytes.subarray(0, 3)) !== ID3_MARKER) {
    return;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const majorVersion = view.getUint8(3);

  if (majorVersion < 3 || majorVersion > 4) {
    return;
  }

  const flags = view.getUint8(5);
  const tagSize = readSynchsafeUint32(view, 6);
  const tagEnd = Math.min(10 + tagSize, bytes.byteLength);
  let offset = 10;

  if ((flags & 0x40) !== 0 && offset + 4 <= tagEnd) {
    const extendedHeaderSize = majorVersion === 4 ? readSynchsafeUint32(view, offset) : readUint32BE(view, offset);
    offset += majorVersion === 4 ? extendedHeaderSize : extendedHeaderSize + 4;
  }

  while (offset + 10 <= tagEnd) {
    const frameId = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
    const frameSize = majorVersion === 4 ? readSynchsafeUint32(view, offset + 4) : readUint32BE(view, offset + 4);
    const frameDataStart = offset + 10;
    const frameDataEnd = frameDataStart + frameSize;

    if (!/^[A-Z0-9]{4}$/.test(frameId) || frameSize <= 0 || frameDataEnd > tagEnd) {
      break;
    }

    if (frameId === 'TXXX') {
      parseId3UserTextFrame(bytes.subarray(frameDataStart, frameDataEnd), metadata);
    }

    offset = frameDataEnd;
  }
}

function findApeFooterOffset(bytes: Uint8Array): number {
  const decoder = new TextDecoder();
  let footerOffset = bytes.byteLength - 32;

  if (bytes.byteLength >= 160 && decoder.decode(bytes.subarray(bytes.byteLength - 128, bytes.byteLength - 125)) === 'TAG') {
    footerOffset -= 128;
  }

  return footerOffset >= 0 && decoder.decode(bytes.subarray(footerOffset, footerOffset + 8)) === 'APETAGEX'
    ? footerOffset
    : -1;
}

function parseApeReplayGain(bytes: Uint8Array, metadata: TrackMetadata): void {
  const footerOffset = findApeFooterOffset(bytes);

  if (footerOffset < 0) {
    return;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tagSize = view.getUint32(footerOffset + 12, true);
  const itemCount = view.getUint32(footerOffset + 16, true);
  const tagStart = footerOffset - tagSize + 32;

  if (tagSize < 32 || itemCount <= 0 || tagStart < 0) {
    return;
  }

  let offset = tagStart;

  for (let index = 0; index < itemCount && offset + 8 <= footerOffset; index += 1) {
    const valueSize = view.getUint32(offset, true);
    const flags = view.getUint32(offset + 4, true);
    const keyStart = offset + 8;
    let keyEnd = keyStart;

    while (keyEnd < footerOffset && bytes[keyEnd] !== 0) {
      keyEnd += 1;
    }

    const valueStart = keyEnd + 1;
    const valueEnd = valueStart + valueSize;

    if (keyEnd >= footerOffset || valueEnd > footerOffset) {
      break;
    }

    const itemType = (flags >> 1) & 0x03;

    if (itemType === 0) {
      const key = new TextDecoder('iso-8859-1').decode(bytes.subarray(keyStart, keyEnd));
      const value = new TextDecoder('utf-8').decode(bytes.subarray(valueStart, valueEnd));
      applyReplayGainComment(metadata, key, value);
    }

    offset = valueEnd;
  }
}

function parseMp3Data(bytes: Uint8Array): ParsedStreamData {
  const metadata: TrackMetadata = {};

  parseId3v2ReplayGain(bytes, metadata);
  parseApeReplayGain(bytes, metadata);

  return {
    metadata,
    artwork: null
  };
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

function buildMediaImage(artwork: EmbeddedStreamArtwork, url: string): MediaImage {
  return {
    src: url,
    type: artwork.blob.type || undefined,
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

  if (extension === 'ogg') {
    return parseOggVorbisData(bytes);
  }

  if (extension === 'mp3') {
    return parseMp3Data(bytes);
  }

  return {
    metadata: {},
    artwork: null
  };
}

function canLoadStreamMetadata(extension: string): boolean {
  return extension === 'flac' || extension === 'opus' || extension === 'ogg' || extension === 'mp3';
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

  return track.id;
}

export async function loadTrackMetadata(track: PlaylistItem | null): Promise<TrackMetadata | null> {
  if (!track || track.kind !== 'stream' || !canLoadStreamMetadata(track.extension)) {
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

export async function loadEmbeddedStreamArtwork(track: PlaylistItem | null): Promise<EmbeddedStreamArtwork | null> {
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

  return {
    blob: new Blob([toArrayBuffer(artwork.data)], { type: artwork.mimeType }),
    width: artwork.width,
    height: artwork.height
  };
}

export async function loadTrackArtwork(track: PlaylistItem | null): Promise<LoadedStreamArtwork | null> {
  const artwork = await loadEmbeddedStreamArtwork(track);

  if (!artwork) {
    return null;
  }

  const url = URL.createObjectURL(artwork.blob);

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
