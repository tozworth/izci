import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { logDebug, logError, logInfo, logWarning } from '$lib/logging/api';
import { readArtwork } from './artwork';
import { cloneMetadataTags, cloneRawMetadata } from './clone';
import { fingerprintFile } from './fingerprint';
import { getMetadataCapabilities } from './format';
import { metadataFieldsFromTags } from './merge';
import type { MetadataDocument, MetadataExtension } from './types';
import { MetadataWriteError } from './types';

export async function readMetadataDocument(
  file: File,
  extension: string,
  signal?: AbortSignal
): Promise<MetadataDocument> {
  if (signal?.aborted) throw signal.reason;
  logDebug('decode', 'Reading media metadata', { name: file.name, size: file.size, extension });
  const capabilities = getMetadataCapabilities(extension);
  if (!capabilities) {
    logWarning('decode', 'Metadata format unsupported', { name: file.name, extension });
    throw new MetadataWriteError('unsupported-format', `.${extension} metadata is not supported.`);
  }
  const normalizedExtension = capabilities.extension as MetadataExtension;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [tags, fingerprint] = await Promise.all([
      input.getMetadataTags(),
      fingerprintFile(file)
    ]);
    if (signal?.aborted) throw signal.reason;
    const sourceTags = cloneMetadataTags(tags);
    const document: MetadataDocument = {
      extension: normalizedExtension,
      fields: metadataFieldsFromTags(sourceTags, normalizedExtension),
      sourceTags,
      raw: cloneRawMetadata(sourceTags.raw),
      artwork: readArtwork(sourceTags.images),
      fingerprint
    };
    logInfo('decode', 'Media metadata read completed', { name: file.name, extension: normalizedExtension, artwork: document.artwork.length, hasLyrics: Boolean(document.fields.lyrics) });
    return document;
  } catch (error) {
    logError('decode', 'Media metadata read failed', { name: file.name, extension, error });
    throw error;
  } finally {
    input.dispose();
  }
}
