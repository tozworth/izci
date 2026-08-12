import {
  type MetadataTags
} from 'mediabunny';
import {
  SUPPORTED_METADATA_EXTENSIONS,
  isMetadataExtension,
  remuxMetadataToBlob,
  remuxMetadataToWritable,
  type MetadataExtension
} from '$lib/services/media-metadata';
import { inferMediaExtension } from '$lib/media/format-policy';

export interface ReplayGainValues {
  trackGainDb: number;
  trackPeak: number;
  albumGainDb?: number;
  albumPeak?: number;
}

export const REPLAYGAIN_WRITABLE_EXTENSIONS = SUPPORTED_METADATA_EXTENSIONS;
type ReplayGainWritableExtension = MetadataExtension;

function formatGain(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} dB`;
}

function formatPeak(value: number): string {
  return value.toFixed(8);
}

function updatedReplayGainFields(
  raw: Record<string, string>,
  values: ReplayGainValues
): Record<string, string> {
  const result = { ...raw };
  result.REPLAYGAIN_TRACK_GAIN = formatGain(values.trackGainDb);
  result.REPLAYGAIN_TRACK_PEAK = formatPeak(values.trackPeak);
  delete result.R128_TRACK_GAIN;
  if (values.albumGainDb !== undefined && values.albumPeak !== undefined) {
    result.REPLAYGAIN_ALBUM_GAIN = formatGain(values.albumGainDb);
    result.REPLAYGAIN_ALBUM_PEAK = formatPeak(values.albumPeak);
    delete result.R128_ALBUM_GAIN;
  }
  return result;
}

export function mergeReplayGainMetadata(
  metadata: MetadataTags,
  values: ReplayGainValues,
  extension: ReplayGainWritableExtension
): MetadataTags {
  const raw = { ...metadata.raw };
  if (extension === 'mp3' || extension === 'wav') {
    const existing = raw.TXXX;
    const userText = existing && typeof existing === 'object' && !(existing instanceof Uint8Array)
      ? existing as Record<string, string>
      : {};
    raw.TXXX = updatedReplayGainFields(userText, values);
  } else {
    const stringFields = Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
    Object.assign(raw, updatedReplayGainFields(stringFields, values));
  }
  return { ...metadata, raw };
}

export async function buildReplayGainTaggedFile(file: File, values: ReplayGainValues): Promise<Blob> {
  const extension = inferMediaExtension(file.name);
  if (!isMetadataExtension(extension)) {
    throw new Error('ReplayGain writing is not supported for this file type.');
  }
  return remuxMetadataToBlob(
    file,
    extension,
    (metadata) => mergeReplayGainMetadata(metadata, values, extension)
  );
}

export async function writeReplayGainInPlace(
  handle: FileSystemFileHandle,
  values: ReplayGainValues
): Promise<void> {
  if (!handle.createWritable) throw new Error('This file handle does not allow in-place writing.');
  const file = await handle.getFile();
  const extension = inferMediaExtension(file.name);
  if (!isMetadataExtension(extension)) throw new Error('ReplayGain writing is not supported for this file type.');
  const writable = await handle.createWritable({ keepExistingData: false });
  await remuxMetadataToWritable(
    file,
    extension,
    (metadata) => mergeReplayGainMetadata(metadata, values, extension),
    writable
  );
}
