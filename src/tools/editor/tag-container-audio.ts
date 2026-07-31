import { remuxMetadataToBlob } from '$lib/services/media-metadata';
import { editableTagsToMetadata } from './clip-metadata';
import type { EditableTags } from './tag-writer';

export type TaggableContainerFormat = 'wav' | 'flac' | 'ogg' | 'opus';

export async function tagContainerAudio(
  sourceFile: File,
  sourceFormat: TaggableContainerFormat,
  tags: EditableTags,
  artwork: Blob | null
): Promise<Blob> {
  const mimeType = sourceFormat === 'wav'
    ? 'audio/wav'
    : sourceFormat === 'flac' ? 'audio/flac' : 'audio/ogg';
  const metadataFormat = sourceFormat === 'wav' ? 'wav' : sourceFormat === 'flac' ? 'flac' : 'opus';
  const editedMetadata = await editableTagsToMetadata(tags, artwork, metadataFormat);

  const tagged = await remuxMetadataToBlob(
    sourceFile,
    sourceFormat,
    sourceFormat === 'wav'
      ? editedMetadata
      : (inputMetadata) => {
          const preservedRaw = { ...inputMetadata.raw };
          delete preservedRaw.COMPOSER;
          delete preservedRaw.TCOM;
          delete preservedRaw.LYRICS;
          delete preservedRaw.SYNCEDLYRICS;
          delete preservedRaw['SYNCED LYRICS'];
          return {
            ...inputMetadata,
            ...editedMetadata,
            raw: { ...preservedRaw, ...editedMetadata.raw }
          };
        }
  );
  return tagged.type === mimeType ? tagged : new Blob([tagged], { type: mimeType });
}
