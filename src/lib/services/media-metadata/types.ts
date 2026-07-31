import type { MetadataTags } from 'mediabunny';

export const MEDIA_METADATA_FIELD_NAMES = [
  'title',
  'artist',
  'albumArtist',
  'album',
  'date',
  'trackNumber',
  'tracksTotal',
  'discNumber',
  'discsTotal',
  'genre',
  'composer',
  'comment',
  'lyrics',
  'isrc',
  'bpm',
  'grouping',
  'copyright',
  'titleSort',
  'artistSort',
  'albumSort',
  'albumArtistSort',
  'composerSort'
] as const;

export type MediaMetadataFieldName = (typeof MEDIA_METADATA_FIELD_NAMES)[number];

/**
 * UI-facing metadata values. Numeric positions are strings so incomplete multi-edit
 * input can remain staged and validated before it is handed to Mediabunny.
 */
export type MediaMetadataFields = Readonly<Record<MediaMetadataFieldName, string>>;

/** Missing keys are untouched; null explicitly removes a field. */
export type MetadataPatch = Partial<Record<MediaMetadataFieldName, string | null>>;

export type ArtworkKind = 'coverFront' | 'coverBack' | 'unknown';

export interface MediaArtworkInput {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly kind: ArtworkKind;
  readonly name?: string;
  readonly description?: string;
}

export interface MediaArtwork extends MediaArtworkInput {
  /** Stable within a document/effective edit chain; not persisted into the media file. */
  readonly id: string;
  readonly size: number;
  readonly width?: number;
  readonly height?: number;
}

/**
 * Targeted artwork operations are applied in order. Untargeted source images are
 * retained exactly, including secondary and unknown-purpose images.
 */
export type ArtworkEdit =
  | { readonly type: 'add'; readonly artwork: MediaArtworkInput; readonly beforeId?: string }
  | { readonly type: 'replace'; readonly targetId: string; readonly artwork: MediaArtworkInput }
  | { readonly type: 'remove'; readonly targetId: string }
  | { readonly type: 'clear' };

export interface MediaFileFingerprint {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  /** Digest of the whole small file, or bounded head/tail samples for large files. */
  readonly sampleHash: string;
}

export type MetadataExtension = 'mp3' | 'wav' | 'flac' | 'ogg' | 'opus';

export interface MetadataCapabilities {
  readonly extension: MetadataExtension;
  readonly readable: true;
  readonly writable: true;
  readonly supportsRaw: true;
  readonly supportsArtwork: true;
  readonly supportsMultipleArtwork: true;
  readonly preservesUnknownTags: true;
  readonly writableFields: readonly MediaMetadataFieldName[];
  readonly artworkKinds: readonly ArtworkKind[];
  readonly remuxMode: 'streaming';
  readonly metadataContainer: 'id3' | 'vorbis-comment' | 'flac-metadata';
}

/** Immutable source snapshot. Applying a patch never mutates this object. */
export interface MetadataDocument {
  readonly extension: MetadataExtension;
  readonly fields: MediaMetadataFields;
  readonly sourceTags: MetadataTags;
  readonly raw: Readonly<NonNullable<MetadataTags['raw']>>;
  readonly artwork: readonly MediaArtwork[];
  readonly fingerprint: MediaFileFingerprint;
}

export interface AppliedMetadata {
  readonly fields: MediaMetadataFields;
  readonly artwork: readonly MediaArtwork[];
  readonly tags: MetadataTags;
}

export interface WriteMetadataOptions {
  readonly signal?: AbortSignal;
  /** Defaults to true. */
  readonly verify?: boolean;
}

export interface MetadataWriteResult {
  readonly document: MetadataDocument;
  readonly verified: boolean;
}

export class MetadataWriteError extends Error {
  constructor(
    readonly code:
      | 'unsupported-format'
      | 'invalid-patch'
      | 'external-change'
      | 'permission-required'
      | 'permission-denied'
      | 'write-unavailable'
      | 'remux-failed'
      | 'verification-failed',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'MetadataWriteError';
  }
}
