import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  OggOutputFormat,
  Output,
  WavOutputFormat
} from 'mediabunny';
import { editableTagsToMetadata } from './clip-metadata';
import type { EditableTags } from './tag-writer';

export type TaggableContainerFormat = 'wav' | 'flac' | 'ogg' | 'opus';

export async function tagContainerAudio(
  sourceFile: File,
  sourceFormat: TaggableContainerFormat,
  tags: EditableTags,
  artwork: Blob | null
): Promise<Blob> {
  const outputFormat = sourceFormat === 'wav'
    ? new WavOutputFormat({ metadataFormat: 'id3' })
    : sourceFormat === 'flac' ? new FlacOutputFormat() : new OggOutputFormat();
  const mimeType = sourceFormat === 'wav'
    ? 'audio/wav'
    : sourceFormat === 'flac' ? 'audio/flac' : 'audio/ogg';
  const input = new Input({ source: new BlobSource(sourceFile), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: outputFormat, target });
  const metadataFormat = sourceFormat === 'wav' ? 'wav' : sourceFormat === 'flac' ? 'flac' : 'opus';
  const editedMetadata = await editableTagsToMetadata(tags, artwork, metadataFormat);

  try {
    const conversion = await Conversion.init({
      input,
      output,
      tags: sourceFormat === 'wav'
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
          },
      showWarnings: false
    });
    if (!conversion.isValid) throw new Error('The source audio cannot be remuxed into its original container.');
    await conversion.execute();
  } finally {
    input.dispose();
  }

  if (!target.buffer) throw new Error('The tagged audio buffer was not produced.');
  return new Blob([target.buffer], { type: mimeType });
}
