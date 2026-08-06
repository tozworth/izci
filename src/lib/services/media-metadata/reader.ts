import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import { readArtwork } from './artwork';
import { cloneMetadataTags, cloneRawMetadata } from './clone';
import { fingerprintFile } from './fingerprint';
import { getMetadataCapabilities } from './format';
import { metadataFieldsFromTags } from './merge';
import type { MetadataDocument, MetadataExtension } from './types';
import { MetadataWriteError } from './types';

export async function readMetadataDocument(
  file: File,
  extension: string
): Promise<MetadataDocument> {
  logDebug('decode', 'Reading metadata', { name: file.name, size: file.size, extension });

  const capabilities = getMetadataCapabilities(extension);
  if (!capabilities) {
    logWarning('decode', 'Unsupported metadata format', { name: file.name, extension });
    throw new MetadataWriteError('unsupported-format', `.${extension} metadata is not supported.`);
  }
  const normalizedExtension = capabilities.extension as MetadataExtension;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [tags, fingerprint] = await Promise.all([
      input.getMetadataTags(),
      fingerprintFile(file)
    ]);
    const sourceTags = cloneMetadataTags(tags);
    const document: MetadataDocument = {
      extension: normalizedExtension,
      fields: metadataFieldsFromTags(sourceTags, normalizedExtension),
      sourceTags,
      raw: cloneRawMetadata(sourceTags.raw),
      artwork: readArtwork(sourceTags.images),
      fingerprint
    };
    logInfo('decode', 'Metadata read completed', {
      name: file.name,
      format: normalizedExtension,
      hasArtwork: document.artwork.length > 0,
      hasLyrics: typeof document.fields.lyrics === 'string' && document.fields.lyrics !== ''
    });
    return document;
  } catch (error) {
    logError('decode', 'Metadata read failed', {
      path: file.name,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    input.dispose();
  }
}
