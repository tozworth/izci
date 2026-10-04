import type { TrackItem, TrackMetadata } from '$lib/types';
import { isDesktop, preparePlaybackRestoration, nativeFilesystem } from '$platform';

import { toArrayBuffer } from './stream-meta-binary';
import { readFlacMetadata } from './stream-meta-flac';
import { readOggMetadata } from './stream-meta-ogg';
import { readMp3Metadata } from './stream-meta-mp3';
import { withMediaFileReader, type ReadFileBytes } from './media-file-reader';
import { readFlacArtwork, readOpusArtwork } from './stream-artwork-reader';

export interface LoadedStreamArtwork {
  url: string;
  mediaImage: MediaImage;
}

interface EmbeddedStreamArtwork {
  blob: Blob;
  width?: number;
  height?: number;
}

interface ReadStreamMetadataOptions {
  maxHeadBytes: number;
  eagerHeadBytes: number;
  mp3TailBytes: number;
  oggScanLimitBytes: number;
  oggDurationTailBytes: number;
  vorbisCommentKeyProbeBytes: number;
  vorbisTextCommentLimitBytes: number;
}

async function readStreamMetadata(file: File, extension: string, trackId: string, options: ReadStreamMetadataOptions = DEFAULT_STREAM_METADATA_OPTIONS): Promise<TrackMetadata> {
  return withMediaFileReader(file, trackId, async (readBytes) => {
    if (extension === 'flac') return readFlacMetadata(file, flacOptions(readBytes, options));
    if (extension === 'opus' || extension === 'ogg') return readOggMetadata(file, extension as 'opus' | 'ogg', oggOptions(readBytes, options));
    if (extension === 'mp3') return readMp3Metadata(file, mp3Options(readBytes, options));
    return {};
  });
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

function flacOptions(readBytes: ReadFileBytes, options: ReadStreamMetadataOptions): { readBytes(offset: number, length: number): Promise<Uint8Array>; maxHeadBytes: number; eagerHeadBytes: number; commentKeyProbeBytes: number; textCommentLimitBytes: number } {
  return {
    readBytes,
    maxHeadBytes: options.maxHeadBytes,
    eagerHeadBytes: options.eagerHeadBytes,
    commentKeyProbeBytes: options.vorbisCommentKeyProbeBytes,
    textCommentLimitBytes: options.vorbisTextCommentLimitBytes
  };
}

function oggOptions(readBytes: ReadFileBytes, options: ReadStreamMetadataOptions): {
  readBytes(offset: number, length: number): Promise<Uint8Array>;
  eagerHeadBytes: number;
  scanLimitBytes: number;
  durationTailBytes: number;
  commentKeyProbeBytes: number;
  textCommentLimitBytes: number;
} {
  return {
    readBytes,
    eagerHeadBytes: options.eagerHeadBytes,
    scanLimitBytes: options.oggScanLimitBytes,
    durationTailBytes: options.oggDurationTailBytes,
    commentKeyProbeBytes: options.vorbisCommentKeyProbeBytes,
    textCommentLimitBytes: options.vorbisTextCommentLimitBytes
  };
}

function mp3Options(readBytes: ReadFileBytes, options: ReadStreamMetadataOptions): {
  readBytes(offset: number, length: number): Promise<Uint8Array>;
  maxHeadBytes: number;
  tailBytes: number;
} {
  return {
    readBytes,
    maxHeadBytes: options.maxHeadBytes,
    tailBytes: options.mp3TailBytes
  };
}

function canLoadStreamMetadata(extension: string): boolean {
  return extension === 'flac' || extension === 'opus' || extension === 'ogg' || extension === 'mp3';
}

async function resolveTrackFile(track: TrackItem): Promise<File | null> {
  if (track.nativeFile && nativeFilesystem) return track.file ?? nativeFilesystem.materializeFile(track.nativeFile);
  if (track.fileHandle) {
    try {
      if (isDesktop && !track.file) await preparePlaybackRestoration(track);
      return await track.fileHandle.getFile();
    } catch (error) {
      // Fall back to the in-memory File when permission is unavailable or stale.
      if (!track.file) throw error;
    }
  }

  return track.file ?? null;
}

export function getTrackArtworkLoadKey(track: TrackItem | null): string {
  if (!track) {
    return '';
  }

  // File wrappers change during hydration; their presence and content version
  // matter, but wrapper identity and metadata-only updates do not.
  return JSON.stringify([track.id, track.extension, track.size, track.lastModified,
    Boolean(track.file), Boolean(track.fileHandle), track.nativeFile?.uri]);
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
    ...(await readStreamMetadata(file, track.extension, track.id)),
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
    // A negative cache entry requires a successful read of the source file.
    throw new Error('Artwork source file is unavailable.');
  }

  const artwork = await withMediaFileReader(file, track.id, (readBytes) =>
    track.extension === 'flac' ? readFlacArtwork(file, readBytes) : readOpusArtwork(file, readBytes));

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
    mediaImage: {
      src: url,
      type: artwork.blob.type || undefined,
      sizes: artwork.width && artwork.height ? `${artwork.width}x${artwork.height}` : undefined
    }
  };
}

export function revokeTrackArtwork(artwork: LoadedStreamArtwork | null | undefined): void {
  if (artwork?.url) {
    URL.revokeObjectURL(artwork.url);
  }
}
