import type { MediaEntity } from '$lib/contracts/catalog';
import type { ReplayGainMetadata, TrackMetadata } from '$lib/contracts/media-metadata';
import { withMediaFile } from '$lib/stores/playlist-materialization';

const FLAC_MARKER = 'fLaC';
const ID3_MARKER = 'ID3';
const OPUS_TAGS_MARKER = 'OpusTags';
const VORBIS_PACKET_MARKER = 'vorbis';
const METADATA_BLOCK_PICTURE_KEY = 'METADATA_BLOCK_PICTURE';
const FLAC_VORBIS_COMMENT_BLOCK_TYPE = 4;
const FLAC_PICTURE_BLOCK_TYPE = 6;
const STREAM_METADATA_MAX_HEAD_BYTES = 4 * 1024 * 1024;
const STREAM_METADATA_EAGER_HEAD_BYTES = 32 * 1024;
const MP3_METADATA_TAIL_BYTES = 1024 * 1024;
const OGG_METADATA_SCAN_LIMIT_BYTES = 64 * 1024 * 1024;
const OGG_DURATION_TAIL_BYTES = 80 * 1024;
const VORBIS_COMMENT_KEY_PROBE_BYTES = 512;
const VORBIS_TEXT_COMMENT_LIMIT_BYTES = 256 * 1024;

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

export function extractStreamVorbisComments(bytes: Uint8Array, format: string): VorbisComment[] {
  if (format === 'flac') {
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

  if (format === 'opus') {
    const packet = extractOpusTagPacket(bytes);

    if (!packet || packet.byteLength < 16) {
      return [];
    }

    const marker = new TextDecoder().decode(packet.subarray(0, 8));
    return marker === OPUS_TAGS_MARKER ? readVorbisCommentsPacket(packet, 8) : [];
  }

  if (format === 'ogg') {
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

function buildMediaImage(artwork: EmbeddedStreamArtwork, url: string): MediaImage {
  return {
    src: url,
    type: artwork.blob.type || undefined,
    sizes: artwork.width && artwork.height ? `${artwork.width}x${artwork.height}` : undefined
  };
}

function extractStreamData(bytes: Uint8Array, format: string): ParsedStreamData {
  if (format === 'flac') {
    return parseFlacData(bytes);
  }

  if (format === 'opus') {
    return parseOpusData(bytes);
  }

  if (format === 'ogg') {
    return parseOggVorbisData(bytes);
  }

  if (format === 'mp3') {
    return parseMp3Data(bytes);
  }

  return {
    metadata: {},
    artwork: null
  };
}

function mergeTrackMetadata(first: TrackMetadata, second: TrackMetadata): TrackMetadata {
  return {
    ...first,
    ...second,
    replayGain:
      first.replayGain || second.replayGain
        ? { ...first.replayGain, ...second.replayGain }
        : undefined
  };
}

interface FileByteRange {
  offset: number;
  length: number;
}

async function readFileBytes(file: File, offset: number, length: number): Promise<Uint8Array> {
  if (length <= 0 || offset >= file.size) return new Uint8Array();
  return new Uint8Array(await file.slice(offset, Math.min(file.size, offset + length)).arrayBuffer());
}

class FileRangeReader {
  readonly #file: File;
  readonly #ranges: FileByteRange[];
  #rangeIndex = 0;
  #rangeOffset = 0;
  #remaining: number;

  constructor(file: File, ranges: FileByteRange[]) {
    this.#file = file;
    this.#ranges = ranges.filter((range) => range.length > 0);
    this.#remaining = this.#ranges.reduce((total, range) => total + range.length, 0);
  }

  get remaining(): number {
    return this.#remaining;
  }

  skip(length: number): boolean {
    if (length < 0 || length > this.#remaining) return false;

    let remaining = length;
    while (remaining > 0) {
      const range = this.#ranges[this.#rangeIndex];
      const available = range.length - this.#rangeOffset;
      const consumed = Math.min(remaining, available);
      this.#rangeOffset += consumed;
      this.#remaining -= consumed;
      remaining -= consumed;

      if (this.#rangeOffset === range.length) {
        this.#rangeIndex += 1;
        this.#rangeOffset = 0;
      }
    }

    return true;
  }

  async read(length: number): Promise<Uint8Array | null> {
    if (length < 0 || length > this.#remaining) return null;

    const result = new Uint8Array(length);
    let resultOffset = 0;

    while (resultOffset < length) {
      const range = this.#ranges[this.#rangeIndex];
      const available = range.length - this.#rangeOffset;
      const requested = Math.min(length - resultOffset, available);
      const bytes = await readFileBytes(this.#file, range.offset + this.#rangeOffset, requested);

      if (bytes.byteLength !== requested) return null;
      result.set(bytes, resultOffset);
      resultOffset += requested;
      this.skip(requested);
    }

    return result;
  }

  async readUint32LE(): Promise<number | null> {
    const bytes = await this.read(4);
    return bytes ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) : null;
  }
}

async function readVorbisMetadata(
  file: File,
  ranges: FileByteRange[],
  expectedPrefix?: Uint8Array
): Promise<TrackMetadata> {
  const reader = new FileRangeReader(file, ranges);

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

    const probeLength = Math.min(commentLength, VORBIS_COMMENT_KEY_PROBE_BYTES);
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

    if (commentLength > VORBIS_TEXT_COMMENT_LIMIT_BYTES) {
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

function concatUint8Arrays(first: Uint8Array, second: Uint8Array): Uint8Array {
  const result = new Uint8Array(first.byteLength + second.byteLength);
  result.set(first, 0);
  result.set(second, first.byteLength);
  return result;
}

async function findOggPacketRanges(file: File, targetPacketIndex: number): Promise<{
  ranges: FileByteRange[];
  streamSerial: number;
} | null> {
  let offset = 0;
  let activeStreamSerial: number | null = null;
  let packetIndex = 0;
  const ranges: FileByteRange[] = [];

  while (offset + 27 <= file.size && offset < OGG_METADATA_SCAN_LIMIT_BYTES) {
    const header = await readFileBytes(file, offset, 27);
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
    const segmentTable = await readFileBytes(file, offset + 27, pageSegments);
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

async function readLastOggGranule(file: File, streamSerial: number): Promise<bigint | null> {
  const tailLength = Math.min(file.size, OGG_DURATION_TAIL_BYTES);
  const tailOffset = file.size - tailLength;
  const tail = await readFileBytes(file, tailOffset, tailLength);

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

async function readOggMetadata(file: File, format: 'opus' | 'ogg'): Promise<TrackMetadata> {
  const head = await readFileBytes(file, 0, Math.min(file.size, STREAM_METADATA_EAGER_HEAD_BYTES));
  const eagerTagsPacket = format === 'opus'
    ? extractOpusTagPacket(head)
    : extractOggVorbisCommentPacket(head);
  let metadata: TrackMetadata;

  if (eagerTagsPacket) {
    metadata = parseVorbisCommentsPacket(eagerTagsPacket, format === 'opus' ? 8 : 7).metadata;
  } else {
    const tagsPacket = await findOggPacketRanges(file, 1);
    if (!tagsPacket) return {};

    const prefix = format === 'opus'
      ? new TextEncoder().encode(OPUS_TAGS_MARKER)
      : concatUint8Arrays(new Uint8Array([0x03]), new TextEncoder().encode(VORBIS_PACKET_MARKER));
    metadata = await readVorbisMetadata(file, tagsPacket.ranges, prefix);
  }

  const eagerIdentification = extractOggPacket(head, 0);
  let identification = eagerIdentification?.subarray(0, format === 'opus' ? 12 : 16) ?? null;
  let streamSerial = head.byteLength >= 18
    ? new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(14, true)
    : null;

  if (!identification || streamSerial === null) {
    const identificationPacket = await findOggPacketRanges(file, 0);
    if (!identificationPacket) return metadata;

    const identificationReader = new FileRangeReader(file, identificationPacket.ranges);
    identification = await identificationReader.read(format === 'opus' ? 12 : 16);
    streamSerial = identificationPacket.streamSerial;
  }

  const granule = await readLastOggGranule(file, streamSerial);

  if (!identification || granule === null) return metadata;

  if (
    format === 'opus' &&
    identification.byteLength >= 12 &&
    new TextDecoder().decode(identification.subarray(0, 8)) === 'OpusHead'
  ) {
    const preSkip = new DataView(identification.buffer, identification.byteOffset, identification.byteLength).getUint16(10, true);
    const samples = granule - BigInt(preSkip);
    if (samples > 0n) metadata.duration = Number(samples) / 48_000;
  }

  if (
    format === 'ogg' &&
    identification.byteLength >= 16 &&
    identification[0] === 0x01 &&
    new TextDecoder().decode(identification.subarray(1, 7)) === VORBIS_PACKET_MARKER
  ) {
    const sampleRate = new DataView(identification.buffer, identification.byteOffset, identification.byteLength).getUint32(12, true);
    if (sampleRate > 0 && granule > 0n) metadata.duration = Number(granule) / sampleRate;
  }

  return metadata;
}

async function readFlacMetadata(file: File): Promise<TrackMetadata> {
  const marker = await readFileBytes(file, 0, 4);
  if (new TextDecoder().decode(marker) !== FLAC_MARKER) return {};

  const metadata: TrackMetadata = {};
  let offset = 4;

  while (offset + 4 <= file.size && offset < STREAM_METADATA_MAX_HEAD_BYTES) {
    const header = await readFileBytes(file, offset, 4);
    if (header.byteLength !== 4) break;

    const isLastBlock = (header[0] & 0x80) !== 0;
    const blockType = header[0] & 0x7f;
    const blockLength = (header[1] << 16) | (header[2] << 8) | header[3];
    const blockOffset = offset + 4;

    if (blockOffset + blockLength > file.size) break;

    if (blockType === 0 && blockLength >= 18) {
      const streamInfo = await readFileBytes(file, blockOffset, Math.min(blockLength, 34));
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
      if (blockLength <= STREAM_METADATA_EAGER_HEAD_BYTES) {
        const comments = await readFileBytes(file, blockOffset, blockLength);
        Object.assign(metadata, parseVorbisCommentsPacket(comments, 0).metadata);
      } else {
        Object.assign(metadata, await readVorbisMetadata(file, [{ offset: blockOffset, length: blockLength }]));
      }
    }

    offset = blockOffset + blockLength;
    if (isLastBlock) break;
  }

  return metadata;
}

async function readMp3Metadata(file: File): Promise<TrackMetadata> {
  const header = await readFileBytes(file, 0, Math.min(file.size, 10));
  let headMetadata: TrackMetadata = {};
  let headLength = header.byteLength;

  if (header.byteLength === 10 && new TextDecoder().decode(header.subarray(0, 3)) === ID3_MARKER) {
    headLength = Math.min(file.size, 10 + readSynchsafeUint32(new DataView(header.buffer), 6), STREAM_METADATA_MAX_HEAD_BYTES);
    headMetadata = parseMp3Data(await readFileBytes(file, 0, headLength)).metadata;
  }

  const tailLength = Math.min(file.size, MP3_METADATA_TAIL_BYTES);
  if (tailLength === 0 || (tailLength === file.size && headLength === file.size)) return headMetadata;

  const tail = await readFileBytes(file, file.size - tailLength, tailLength);
  return mergeTrackMetadata(headMetadata, parseMp3Data(tail).metadata);
}

async function readStreamMetadata(file: File, format: string): Promise<TrackMetadata> {
  if (format === 'flac') return readFlacMetadata(file);
  if (format === 'opus' || format === 'ogg') return readOggMetadata(file, format);
  if (format === 'mp3') return readMp3Metadata(file);
  return {};
}

function canLoadStreamMetadata(format: string): boolean {
  return format === 'flac' || format === 'opus' || format === 'ogg' || format === 'mp3';
}

function extractArtwork(bytes: Uint8Array, format: string): ParsedArtwork | null {
  return extractStreamData(bytes, format).artwork;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function getTrackArtworkLoadKey(track: MediaEntity | null): string {
  if (!track) {
    return '';
  }

  return track.id;
}

export async function loadTrackMetadataFromFile(
  file: File,
  format: string
): Promise<TrackMetadata | null> {
  if (!canLoadStreamMetadata(format)) {
    return null;
  }

  return {
    ...(await readStreamMetadata(file, format)),
    embeddedMetadataLoaded: true
  };
}

export async function loadTrackMetadata(track: MediaEntity | null): Promise<TrackMetadata | null> {
  if (!track || track.kind !== 'stream' || !canLoadStreamMetadata(track.format)) {
    return null;
  }

  return withMediaFile(track, (file) => loadTrackMetadataFromFile(file, track.format));
}

export async function loadEmbeddedStreamArtwork(track: MediaEntity | null): Promise<EmbeddedStreamArtwork | null> {
  if (!track || track.kind !== 'stream' || (track.format !== 'flac' && track.format !== 'opus')) {
    return null;
  }

  return withMediaFile(track, async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const artwork = extractArtwork(bytes, track.format);
    if (!artwork || artwork.data.byteLength === 0) return null;
    return {
      blob: new Blob([toArrayBuffer(artwork.data)], { type: artwork.mimeType }),
      width: artwork.width,
      height: artwork.height
    };
  });
}

export async function loadTrackArtwork(track: MediaEntity | null): Promise<LoadedStreamArtwork | null> {
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
