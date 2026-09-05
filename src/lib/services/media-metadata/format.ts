import {
  FlacOutputFormat,
  Mp3OutputFormat,
  OggOutputFormat,
  WavOutputFormat,
  type OutputFormat
} from 'mediabunny';
import { MEDIA_METADATA_FIELD_NAMES, type MetadataCapabilities, type MetadataExtension } from './types';

const SUPPORTED_METADATA_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'opus'] as const;
const ARTWORK_KINDS = ['coverFront', 'coverBack', 'unknown'] as const;
const COMMON_CAPABILITIES = {
  readable: true,
  writable: true,
  supportsRaw: true,
  supportsArtwork: true,
  supportsMultipleArtwork: true,
  preservesUnknownTags: true,
  writableFields: MEDIA_METADATA_FIELD_NAMES,
  artworkKinds: ARTWORK_KINDS,
  remuxMode: 'streaming'
} as const;

const capabilityMap: Record<MetadataExtension, MetadataCapabilities> = {
  mp3: {
    ...COMMON_CAPABILITIES, extension: 'mp3',
    metadataContainer: 'id3'
  },
  wav: {
    ...COMMON_CAPABILITIES, extension: 'wav',
    metadataContainer: 'id3'
  },
  flac: {
    ...COMMON_CAPABILITIES, extension: 'flac',
    metadataContainer: 'flac-metadata'
  },
  ogg: {
    ...COMMON_CAPABILITIES, extension: 'ogg',
    metadataContainer: 'vorbis-comment'
  },
  opus: {
    ...COMMON_CAPABILITIES, extension: 'opus',
    metadataContainer: 'vorbis-comment'
  }
};

export function isMetadataExtension(value: string): value is MetadataExtension {
  return SUPPORTED_METADATA_EXTENSIONS.includes(value.toLowerCase() as MetadataExtension);
}

export function getMetadataCapabilities(extension: string): MetadataCapabilities | null {
  const normalized = extension.toLowerCase();
  return isMetadataExtension(normalized) ? capabilityMap[normalized] : null;
}

export function createMetadataOutputFormat(extension: MetadataExtension): OutputFormat {
  switch (extension) {
    case 'mp3': return new Mp3OutputFormat();
    case 'wav': return new WavOutputFormat({ metadataFormat: 'id3' });
    case 'flac': return new FlacOutputFormat();
    case 'ogg':
    case 'opus': return new OggOutputFormat();
  }
}

export function metadataMimeType(extension: MetadataExtension): string {
  switch (extension) {
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'flac': return 'audio/flac';
    case 'ogg': return 'audio/ogg';
    case 'opus': return 'audio/opus';
  }
}
