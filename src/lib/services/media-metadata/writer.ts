import { fingerprintFile, fingerprintsMatch } from './fingerprint';
import { getMetadataCapabilities } from './format';
import { applyMetadataPatch } from './merge';
import { queryMetadataWritePermission } from './permissions';
import { readMetadataDocument } from './reader';
import { remuxMetadataToWritable } from './remux';
import type {
  ArtworkEdit,
  MediaArtwork,
  MetadataDocument,
  MetadataPatch,
  MetadataWriteResult,
  WriteMetadataOptions
} from './types';
import { MEDIA_METADATA_FIELD_NAMES, MetadataWriteError } from './types';

function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
  if (first.byteLength !== second.byteLength) return false;
  for (let index = 0; index < first.byteLength; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function artworkEqual(first: readonly MediaArtwork[], second: readonly MediaArtwork[]): boolean {
  return first.length === second.length && first.every((image, index) => {
    const other = second[index];
    return image.mimeType === other.mimeType
      && image.kind === other.kind
      && image.description === other.description
      && bytesEqual(image.data, other.data);
  });
}

async function materializeSourceFile(file: File): Promise<File> {
  return new File([await file.arrayBuffer()], file.name, {
    type: file.type,
    lastModified: file.lastModified
  });
}

function verifyPatch(
  result: MetadataDocument,
  expected: ReturnType<typeof applyMetadataPatch>,
  patch: MetadataPatch,
  artworkPatch?: ArtworkEdit | readonly ArtworkEdit[]
): void {
  for (const field of MEDIA_METADATA_FIELD_NAMES) {
    if (field in patch && result.fields[field] !== expected.fields[field]) {
      throw new MetadataWriteError(
        'verification-failed',
        `${field} was written as ${JSON.stringify(result.fields[field])}; expected ${JSON.stringify(expected.fields[field])}.`
      );
    }
  }
  if (artworkPatch && !artworkEqual(result.artwork, expected.artwork)) {
    throw new MetadataWriteError('verification-failed', 'Embedded artwork did not match the staged artwork after writing.');
  }
}

/** Re-reads every managed tag plus the raw tag map, not just the fields in the patch. */
function verifyFullMetadata(
  result: MetadataDocument,
  expected: ReturnType<typeof applyMetadataPatch>
): void {
  verifyPatch(result, expected, Object.fromEntries(MEDIA_METADATA_FIELD_NAMES.map((field) => [field, null])));
  if (!artworkEqual(result.artwork, expected.artwork)) {
    throw new MetadataWriteError('verification-failed', 'Embedded artwork did not match the staged artwork after writing.');
  }
  const expectedRaw = Object.entries(expected.tags.raw ?? {}).filter(([, value]) => value !== null);
  for (const [key, value] of expectedRaw) {
    if (JSON.stringify(result.raw[key]) !== JSON.stringify(value)) {
      throw new MetadataWriteError('verification-failed', `Raw tag ${key} did not survive the write.`);
    }
  }
}

export async function writeMetadataDocumentInPlace(
  handle: FileSystemFileHandle,
  document: MetadataDocument,
  patch: MetadataPatch,
  artworkPatch?: ArtworkEdit | readonly ArtworkEdit[],
  options: WriteMetadataOptions = {}
): Promise<MetadataWriteResult> {
  options.signal?.throwIfAborted();
  if (!getMetadataCapabilities(document.extension)) {
    throw new MetadataWriteError('unsupported-format', `.${document.extension} metadata is not supported.`);
  }
  const expected = applyMetadataPatch(document, patch, artworkPatch);
  // A disk-backed File snapshot can become unreadable as soon as Chromium opens a
  // writable for the same entry. Materialize it before createWritable() so the
  // remux never races the source handle it is replacing.
  const currentFile = await materializeSourceFile(await handle.getFile());
  const currentFingerprint = await fingerprintFile(currentFile);
  if (!fingerprintsMatch(document.fingerprint, currentFingerprint)) {
    throw new MetadataWriteError(
      'external-change',
      'The file changed after its metadata was loaded. Reload it before saving.'
    );
  }

  const permission = await queryMetadataWritePermission(handle);
  if (permission === 'prompt') {
    throw new MetadataWriteError(
      'permission-required',
      'Write access must be granted from a direct user action before saving.'
    );
  }
  if (permission !== 'granted') {
    throw new MetadataWriteError('permission-denied', 'Write access to this file was denied.');
  }
  if (!handle.createWritable) {
    throw new MetadataWriteError('write-unavailable', 'This file handle does not support in-place writes.');
  }

  options.signal?.throwIfAborted();
  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await remuxMetadataToWritable(
      currentFile,
      document.extension,
      expected.tags,
      writable,
      options.signal
    );
  } catch (error) {
    if (error instanceof MetadataWriteError || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
    throw new MetadataWriteError('remux-failed', 'Metadata could not be written.', { cause: error });
  }

  // Keep the verification reader detached from the filesystem entry too. Even
  // after Input.dispose(), Chromium may retain state associated with a BlobSource
  // long enough for the next atomic replace to fail at close().
  const writtenFile = await materializeSourceFile(await handle.getFile());
  const result = await readMetadataDocument(writtenFile, document.extension);
  const shouldVerify = options.verify !== false;
  if (shouldVerify) {
    if (options.fullVerification) verifyFullMetadata(result, expected);
    else verifyPatch(result, expected, patch, artworkPatch);
  }
  return { document: result, verified: shouldVerify };
}
