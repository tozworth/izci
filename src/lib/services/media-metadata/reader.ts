import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
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
  const capabilities = getMetadataCapabilities(extension);
  if (!capabilities) {
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
    return {
      extension: normalizedExtension,
      fields: metadataFieldsFromTags(sourceTags, normalizedExtension),
      sourceTags,
      raw: cloneRawMetadata(sourceTags.raw),
      artwork: readArtwork(sourceTags.images),
      fingerprint
    };
  } finally {
    input.dispose();
  }
}
