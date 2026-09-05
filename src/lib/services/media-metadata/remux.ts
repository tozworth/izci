import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  type MetadataTags
} from 'mediabunny';
import { createMetadataOutputFormat, metadataMimeType } from './format';
import type { MetadataExtension } from './types';
import { MetadataWriteError } from './types';

type MetadataTagsSource = MetadataTags | ((source: MetadataTags) => MetadataTags | Promise<MetadataTags>);

async function writeBlobToWritable(
  writable: FileSystemWritableFileStream,
  blob: Blob
): Promise<void> {
  if (typeof writable.write === 'function' && typeof writable.close === 'function') {
    await writable.write(blob);
    await writable.close();
    return;
  }
  const writer = writable.getWriter();
  try {
    await writer.write(blob as unknown as FileSystemWriteChunkType);
    await writer.close();
  } finally {
    writer.releaseLock();
  }
}

async function executeConversion(
  input: Input,
  output: Output,
  tags: MetadataTagsSource,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const conversion = await Conversion.init({ input, output, tags, showWarnings: false });
  if (!conversion.isValid) {
    throw new MetadataWriteError('remux-failed', 'The source audio cannot be remuxed into its original container.');
  }
  if (signal?.aborted) {
    await conversion.cancel();
    signal.throwIfAborted();
  }
  const abort = () => { void conversion.cancel(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await conversion.execute();
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

export async function remuxMetadataToBlob(
  sourceFile: File,
  extension: MetadataExtension,
  tags: MetadataTagsSource,
  signal?: AbortSignal
): Promise<Blob> {
  const input = new Input({ source: new BlobSource(sourceFile), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: createMetadataOutputFormat(extension), target });
  try {
    await executeConversion(input, output, tags, signal);
  } finally {
    input.dispose();
  }
  if (!target.buffer) throw new MetadataWriteError('remux-failed', 'The tagged audio buffer was not produced.');
  return new Blob([target.buffer], { type: sourceFile.type || metadataMimeType(extension) });
}

export async function remuxMetadataToWritable(
  sourceFile: File,
  extension: MetadataExtension,
  tags: MetadataTagsSource,
  writable: FileSystemWritableFileStream,
  signal?: AbortSignal
): Promise<void> {
  const blob = await remuxMetadataToBlob(sourceFile, extension, tags, signal);
  signal?.throwIfAborted();
  try {
    // Chromium's atomic File System Access commit is much more reliable when it
    // receives one plain Blob write than when a remuxer owns/positions the native
    // stream. Keeping the remux in memory also guarantees cleanup stays unlocked.
    await writeBlobToWritable(writable, blob);
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    throw error;
  }
}
