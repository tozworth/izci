import type { EmbeddedStreamArtwork } from './stream-artwork';
import { parseFlacData, parsePictureBlock } from './stream-meta-flac';
import { parseOpusData, parseOggVorbisData } from './stream-meta-ogg';
import { parseMp3Data } from './stream-meta-mp3';
import type { ParsedStreamData, ParsedArtwork } from './stream-meta-flac';

export function buildMediaImage(artwork: EmbeddedStreamArtwork, url: string): MediaImage {
  return {
    src: url,
    type: artwork.blob.type || undefined,
    sizes: artwork.width && artwork.height ? `${artwork.width}x${artwork.height}` : undefined
  };
}

export function extractStreamData(bytes: Uint8Array, extension: string): ParsedStreamData {
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

export function extractArtwork(bytes: Uint8Array, extension: string): ParsedArtwork | null {
  return extractStreamData(bytes, extension).artwork;
}

export { parsePictureBlock };
