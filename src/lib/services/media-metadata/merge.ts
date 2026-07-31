import type { MetadataTags } from 'mediabunny';
import { applyArtworkEdits, artworkToAttachedImages } from './artwork';
import { cloneMetadataTags, cloneRawMetadata } from './clone';
import type {
  AppliedMetadata,
  ArtworkEdit,
  MediaMetadataFieldName,
  MediaMetadataFields,
  MetadataDocument,
  MetadataExtension,
  MetadataPatch
} from './types';
import { MEDIA_METADATA_FIELD_NAMES, MetadataWriteError } from './types';

type Raw = NonNullable<MetadataTags['raw']>;

const ID3_ALIASES: Record<MediaMetadataFieldName, readonly string[]> = {
  title: ['TIT2', 'TT2', 'INAM'],
  artist: ['TPE1', 'TP1', 'IART'],
  albumArtist: ['TPE2', 'TP2'],
  album: ['TALB', 'TAL', 'IPRD'],
  date: ['TDRC', 'TYER', 'TYE', 'TDAT', 'ICRD'],
  trackNumber: ['TRCK', 'TRK', 'ITRK'],
  tracksTotal: ['TRCK', 'TRK', 'ITRK'],
  discNumber: ['TPOS', 'TPA'],
  discsTotal: ['TPOS', 'TPA'],
  genre: ['TCON', 'TCO', 'IGNR'],
  composer: ['TCOM', 'IMUS'],
  comment: ['COMM', 'COM', 'ICMT'],
  lyrics: ['USLT', 'ULT', 'SYLT'],
  isrc: ['TSRC'],
  bpm: ['TBPM'],
  grouping: ['TIT1'],
  copyright: ['TCOP', 'ICOP'],
  titleSort: ['TSOT'],
  artistSort: ['TSOP'],
  albumSort: ['TSOA'],
  albumArtistSort: ['TSO2'],
  composerSort: ['TSOC']
};

const VORBIS_ALIASES: Record<MediaMetadataFieldName, readonly string[]> = {
  title: ['TITLE'],
  artist: ['ARTIST'],
  albumArtist: ['ALBUMARTIST', 'ALBUM ARTIST'],
  album: ['ALBUM'],
  date: ['DATE', 'YEAR'],
  trackNumber: ['TRACKNUMBER'],
  tracksTotal: ['TRACKTOTAL', 'TOTALTRACKS'],
  discNumber: ['DISCNUMBER'],
  discsTotal: ['DISCTOTAL', 'TOTALDISCS'],
  genre: ['GENRE'],
  composer: ['COMPOSER'],
  comment: ['COMMENT', 'DESCRIPTION'],
  lyrics: ['LYRICS', 'UNSYNCEDLYRICS', 'SYNCEDLYRICS', 'SYNCED LYRICS'],
  isrc: ['ISRC'],
  bpm: ['BPM'],
  grouping: ['GROUPING'],
  copyright: ['COPYRIGHT'],
  titleSort: ['TITLESORT'],
  artistSort: ['ARTISTSORT'],
  albumSort: ['ALBUMSORT'],
  albumArtistSort: ['ALBUMARTISTSORT'],
  composerSort: ['COMPOSERSORT']
};

const NORMALIZED_PROPERTIES: Partial<Record<MediaMetadataFieldName, keyof MetadataTags>> = {
  title: 'title', artist: 'artist', albumArtist: 'albumArtist', album: 'album',
  trackNumber: 'trackNumber', tracksTotal: 'tracksTotal', discNumber: 'discNumber',
  discsTotal: 'discsTotal', genre: 'genre', comment: 'comment', lyrics: 'lyrics'
};

const NUMERIC_FIELDS = new Set<MediaMetadataFieldName>([
  'trackNumber', 'tracksTotal', 'discNumber', 'discsTotal'
]);

function aliases(extension: MetadataExtension): Record<MediaMetadataFieldName, readonly string[]> {
  return extension === 'mp3' || extension === 'wav' ? ID3_ALIASES : VORBIS_ALIASES;
}

function rawString(raw: Raw, names: readonly string[]): string {
  const wanted = new Set(names.map((name) => name.toUpperCase()));
  for (const [key, value] of Object.entries(raw)) {
    if (wanted.has(key.toUpperCase()) && typeof value === 'string') return value;
  }
  return '';
}

function sourcePosition(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

export function metadataFieldsFromTags(
  tags: MetadataTags,
  extension: MetadataExtension
): MediaMetadataFields {
  const raw = tags.raw ?? {};
  const rawAliases = aliases(extension);
  const fields: Record<MediaMetadataFieldName, string> = {
    title: tags.title ?? rawString(raw, rawAliases.title),
    artist: tags.artist ?? rawString(raw, rawAliases.artist),
    albumArtist: tags.albumArtist ?? rawString(raw, rawAliases.albumArtist),
    album: tags.album ?? rawString(raw, rawAliases.album),
    date: rawString(raw, rawAliases.date) || (tags.date ? tags.date.toISOString().slice(0, 10) : ''),
    trackNumber: sourcePosition(tags.trackNumber),
    tracksTotal: sourcePosition(tags.tracksTotal),
    discNumber: sourcePosition(tags.discNumber),
    discsTotal: sourcePosition(tags.discsTotal),
    genre: tags.genre ?? rawString(raw, rawAliases.genre),
    composer: rawString(raw, rawAliases.composer),
    comment: tags.comment ?? rawString(raw, rawAliases.comment),
    lyrics: tags.lyrics ?? rawString(raw, rawAliases.lyrics),
    isrc: rawString(raw, rawAliases.isrc),
    bpm: rawString(raw, rawAliases.bpm),
    grouping: rawString(raw, rawAliases.grouping),
    copyright: rawString(raw, rawAliases.copyright),
    titleSort: rawString(raw, rawAliases.titleSort),
    artistSort: rawString(raw, rawAliases.artistSort),
    albumSort: rawString(raw, rawAliases.albumSort),
    albumArtistSort: rawString(raw, rawAliases.albumArtistSort),
    composerSort: rawString(raw, rawAliases.composerSort)
  };
  return fields;
}

function removeRawKeys(raw: Raw, names: readonly string[]): void {
  const wanted = new Set(names.map((name) => name.toUpperCase()));
  for (const key of Object.keys(raw)) {
    if (wanted.has(key.toUpperCase())) delete raw[key];
  }
}

function parsePosition(field: MediaMetadataFieldName, value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new MetadataWriteError('invalid-patch', `${field} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new MetadataWriteError('invalid-patch', `${field} is too large.`);
  }
  return parsed;
}

function validatePatch(patch: MetadataPatch): void {
  for (const [field, value] of Object.entries(patch)) {
    if (!MEDIA_METADATA_FIELD_NAMES.includes(field as MediaMetadataFieldName)) {
      throw new MetadataWriteError('invalid-patch', `Unknown metadata field: ${field}.`);
    }
    if (value !== null && typeof value !== 'string') {
      throw new MetadataWriteError('invalid-patch', `${field} must be a string or null.`);
    }
    if (value !== null && NUMERIC_FIELDS.has(field as MediaMetadataFieldName)) {
      parsePosition(field as MediaMetadataFieldName, value);
    }
  }
}

function setTagProperty(
  tags: MetadataTags,
  property: keyof MetadataTags,
  value: string | null,
  field: MediaMetadataFieldName
): void {
  const mutable = tags as Record<string, unknown>;
  if (value === null) mutable[property] = undefined;
  else if (NUMERIC_FIELDS.has(field)) mutable[property] = parsePosition(field, value);
  else mutable[property] = value;
}

function canonicalRawKey(extension: MetadataExtension, field: MediaMetadataFieldName): string {
  return aliases(extension)[field][0];
}

export function applyMetadataPatch(
  document: MetadataDocument,
  patch: MetadataPatch,
  artworkPatch?: ArtworkEdit | readonly ArtworkEdit[]
): AppliedMetadata {
  validatePatch(patch);
  const fields = { ...document.fields } as Record<MediaMetadataFieldName, string>;
  const tags = cloneMetadataTags(document.sourceTags);
  const raw = cloneRawMetadata(tags.raw);
  tags.raw = raw;
  const fieldAliases = aliases(document.extension);

  for (const field of MEDIA_METADATA_FIELD_NAMES) {
    if (!(field in patch)) continue;
    const value = patch[field] ?? null;
    fields[field] = value ?? '';
    removeRawKeys(raw, fieldAliases[field]);
    const property = NORMALIZED_PROPERTIES[field];
    if (property) {
      setTagProperty(tags, property, value, field);
      continue;
    }
    if (field === 'date') {
      tags.date = undefined;
      if (value !== null) raw[canonicalRawKey(document.extension, field)] = value;
      continue;
    }
    if (value !== null) raw[canonicalRawKey(document.extension, field)] = value;
  }

  const artwork = applyArtworkEdits(document.artwork, artworkPatch);
  if ((document.extension === 'mp3' || document.extension === 'wav')
    && (document.artwork.length > 0 || artworkPatch)) {
    // Mediabunny exposes APIC both as normalized images and raw frame bytes. Keeping
    // both would duplicate every source image when the ID3 tag is regenerated.
    removeRawKeys(raw, ['APIC', 'PIC']);
  }
  tags.images = artworkToAttachedImages(artwork);
  return { fields, artwork, tags };
}
