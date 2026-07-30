import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  OggOutputFormat,
  Output,
  WavOutputFormat,
  type MetadataTags
} from 'mediabunny';
import { inferExtension } from '$lib/utils/files';

export interface ReplayGainValues {
  trackGainDb: number;
  trackPeak: number;
  albumGainDb?: number;
  albumPeak?: number;
}

export const REPLAYGAIN_WRITABLE_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'opus'] as const;
type ReplayGainWritableExtension = (typeof REPLAYGAIN_WRITABLE_EXTENSIONS)[number];

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

function createOutputFormat(extension: ReplayGainWritableExtension) {
  switch (extension) {
    case 'mp3': return new Mp3OutputFormat();
    case 'wav': return new WavOutputFormat({ metadataFormat: 'id3' });
    case 'flac': return new FlacOutputFormat();
    case 'ogg':
    case 'opus': return new OggOutputFormat();
  }
}

export async function buildReplayGainTaggedFile(file: File, values: ReplayGainValues): Promise<Blob> {
  const extension = inferExtension(file.name) as ReplayGainWritableExtension;
  if (!REPLAYGAIN_WRITABLE_EXTENSIONS.includes(extension)) {
    throw new Error('ReplayGain writing is not supported for this file type.');
  }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: createOutputFormat(extension), target });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tags: (metadata) => mergeReplayGainMetadata(metadata, values, extension),
      showWarnings: false
    });
    if (!conversion.isValid) throw new Error('The file cannot be remuxed safely with ReplayGain tags.');
    await conversion.execute();
  } finally {
    input.dispose();
  }
  if (!target.buffer) throw new Error('The tagged file was not produced.');
  return new Blob([target.buffer], { type: file.type || 'application/octet-stream' });
}

export async function writeReplayGainInPlace(
  handle: FileSystemFileHandle,
  values: ReplayGainValues
): Promise<void> {
  const tagged = await buildReplayGainTaggedFile(await handle.getFile(), values);
  if (!handle.createWritable) throw new Error('This file handle does not allow in-place writing.');
  const writable = await handle.createWritable();
  try {
    await writable.write(tagged);
    await writable.close();
  } catch (error) {
    const abortable = writable as typeof writable & { abort?: () => Promise<void> };
    await abortable.abort?.().catch(() => undefined);
    throw error;
  }
}
