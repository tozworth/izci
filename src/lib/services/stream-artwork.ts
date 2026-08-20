import type { TrackItem, TrackMetadata } from '$lib/types';

import { readUint24BE, readUint32BE, readSynchsafeUint32, decodeBase64, concatUint8Arrays, toArrayBuffer } from './stream-meta-binary';
import {
  normalizeReplayGainDb,
  normalizeReplayGainPeak,
  normalizeR128GainDb,
  ensureReplayGain,
  assignReplayGainValue,
  applyReplayGainComment,
  parseDecimalTagValue
} from './stream-meta-replaygain';
import { readFlacMetadata, parseFlacData, parsePictureBlock, parseVorbisCommentsPacket, trimTagValue, normalizeYearTagValue, applyVorbisComment } from './stream-meta-flac';
import { readOggMetadata, extractOggPacket, extractOpusTagPacket, extractOggVorbisCommentPacket, parseOpusData, parseOggVorbisData, findOggPacketRanges, readLastOggGranule } from './stream-meta-ogg';
import { readMp3Metadata, parseMp3Data, parseId3UserTextFrame, parseId3v2ReplayGain, findApeFooterOffset, parseApeReplayGain } from './stream-meta-mp3';
import { extractStreamVorbisComments, readVorbisCommentsPacket } from './stream-meta-ogg';
import { extractArtwork, buildMediaImage } from './stream-artwork-extract';

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

export interface ParsedArtwork {
  mimeType: string;
  data: Uint8Array;
  width?: number;
  height?: number;
  pictureType?: number;
}

export interface ParsedVorbisComments {
  metadata: TrackMetadata;
  artwork: ParsedArtwork | null;
}

export interface ParsedStreamData {
  metadata: TrackMetadata;
  artwork: ParsedArtwork | null;
}

export { readVorbisCommentsPacket, extractStreamVorbisComments } from './stream-meta-ogg';
export { readFlacMetadata, parseFlacData, parsePictureBlock, parseVorbisCommentsPacket, trimTagValue, normalizeYearTagValue, applyVorbisComment } from './stream-meta-flac';
export { readOggMetadata, extractOggPacket, extractOpusTagPacket, extractOggVorbisCommentPacket, parseOpusData, parseOggVorbisData, findOggPacketRanges, readLastOggGranule } from './stream-meta-ogg';
export { readMp3Metadata, parseMp3Data, parseId3UserTextFrame, parseId3v2ReplayGain, findApeFooterOffset, parseApeReplayGain } from './stream-meta-mp3';
export { extractArtwork } from './stream-artwork-extract';
export { readUint24BE, readUint32BE, readSynchsafeUint32, decodeBase64, concatUint8Arrays, toArrayBuffer } from './stream-meta-binary';
export {
  normalizeReplayGainDb,
  normalizeReplayGainPeak,
  normalizeR128GainDb,
  ensureReplayGain,
  assignReplayGainValue,
  applyReplayGainComment,
  parseDecimalTagValue
} from './stream-meta-replaygain';

export interface FileByteRange {
  offset: number;
  length: number;
}

export interface ReadStreamMetadataOptions {
  maxHeadBytes: number;
  eagerHeadBytes: number;
  mp3TailBytes: number;
  oggScanLimitBytes: number;
  oggDurationTailBytes: number;
  vorbisCommentKeyProbeBytes: number;
  vorbisTextCommentLimitBytes: number;
}

export async function readStreamMetadata(file: File, extension: string, options: ReadStreamMetadataOptions = DEFAULT_STREAM_METADATA_OPTIONS): Promise<TrackMetadata> {
  if (extension === 'flac') return readFlacMetadata(file, flacOptions(file, options));
  if (extension === 'opus' || extension === 'ogg') return readOggMetadata(file, extension as 'opus' | 'ogg', oggOptions(file, options));
  if (extension === 'mp3') return readMp3Metadata(file, mp3Options(file, options));
  return {};
}

const DEFAULT_STREAM_METADATA_OPTIONS: ReadStreamMetadataOptions = {
  maxHeadBytes: 4 * 1024 * 1024,
  eagerHeadBytes: 32 * 1024,
  mp3TailBytes: 1024 * 1024,
  oggScanLimitBytes: 64 * 1024 * 1024,
  oggDurationTailBytes: 80 * 1024,
  vorbisCommentKeyProbeBytes: 512,
  vorbisTextCommentLimitBytes: 256 * 1024
};

function flacOptions(file: File, options: ReadStreamMetadataOptions): { readBytes(offset: number, length: number): Promise<Uint8Array>; maxHeadBytes: number; eagerHeadBytes: number; commentKeyProbeBytes: number; textCommentLimitBytes: number } {
  return {
    readBytes: (offset, length) => readFileBytes(file, offset, length),
    maxHeadBytes: options.maxHeadBytes,
    eagerHeadBytes: options.eagerHeadBytes,
    commentKeyProbeBytes: options.vorbisCommentKeyProbeBytes,
    textCommentLimitBytes: options.vorbisTextCommentLimitBytes
  };
}

function oggOptions(file: File, options: ReadStreamMetadataOptions): {
  readBytes(offset: number, length: number): Promise<Uint8Array>;
  eagerHeadBytes: number;
  scanLimitBytes: number;
  durationTailBytes: number;
  commentKeyProbeBytes: number;
  textCommentLimitBytes: number;
} {
  return {
    readBytes: (offset, length) => readFileBytes(file, offset, length),
    eagerHeadBytes: options.eagerHeadBytes,
    scanLimitBytes: options.oggScanLimitBytes,
    durationTailBytes: options.oggDurationTailBytes,
    commentKeyProbeBytes: options.vorbisCommentKeyProbeBytes,
    textCommentLimitBytes: options.vorbisTextCommentLimitBytes
  };
}

function mp3Options(file: File, options: ReadStreamMetadataOptions): {
  readBytes(offset: number, length: number): Promise<Uint8Array>;
  maxHeadBytes: number;
  tailBytes: number;
} {
  return {
    readBytes: (offset, length) => readFileBytes(file, offset, length),
    maxHeadBytes: options.maxHeadBytes,
    tailBytes: options.mp3TailBytes
  };
}

async function readFileBytes(file: File, offset: number, length: number): Promise<Uint8Array> {
  if (length <= 0 || offset >= file.size) return new Uint8Array();
  return new Uint8Array(await file.slice(offset, Math.min(file.size, offset + length)).arrayBuffer());
}

export function canLoadStreamMetadata(extension: string): boolean {
  return extension === 'flac' || extension === 'opus' || extension === 'ogg' || extension === 'mp3';
}

async function resolveTrackFile(track: TrackItem): Promise<File | null> {
  if (track.fileHandle) {
    try {
      return await track.fileHandle.getFile();
    } catch {
      // Fall back to the in-memory File when permission is unavailable or stale.
    }
  }

  return track.file ?? null;
}

export function getTrackArtworkLoadKey(track: TrackItem | null): string {
  if (!track) {
    return '';
  }

  return track.id;
}

export async function loadTrackMetadata(track: TrackItem | null): Promise<TrackMetadata | null> {
  if (!track || track.kind !== 'stream' || !canLoadStreamMetadata(track.extension)) {
    return null;
  }

  const file = await resolveTrackFile(track);

  if (!file) {
    return null;
  }

  const metadata: TrackMetadata = {
    ...(await readStreamMetadata(file, track.extension)),
    embeddedMetadataLoaded: true
  };

  return metadata;
}

export async function loadEmbeddedStreamArtwork(track: TrackItem | null): Promise<EmbeddedStreamArtwork | null> {
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

export async function loadTrackArtwork(track: TrackItem | null): Promise<LoadedStreamArtwork | null> {
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
