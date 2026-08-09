export interface ConverterOutputLocation {
  directory: FileSystemDirectoryHandle;
  fileName: string;
}
import { logError, logInfo } from '$lib/services/logging';

export async function resolveConverterOutputLocation(
  root: FileSystemDirectoryHandle,
  directories: readonly string[],
  fileName: string
): Promise<ConverterOutputLocation> {
  let directory = root;
  for (const segment of directories) {
    if (!segment || segment === '.' || segment === '..') continue;
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }
  return { directory, fileName };
}

export async function converterOutputExists(location: ConverterOutputLocation): Promise<boolean> {
  try {
    await location.directory.getFileHandle(location.fileName);
    return true;
  } catch (error) {
    if ((error as DOMException)?.name === 'NotFoundError') return false;
    throw error;
  }
}

export async function writeConverterOutput(location: ConverterOutputLocation, blob: Blob): Promise<void> {
  const handle = await location.directory.getFileHandle(location.fileName, { create: true });
  const writable = await handle.createWritable?.();
  if (!writable) throw new Error('This browser cannot write to the selected output folder.');
  try {
    await writable.write(blob);
    await writable.close();
    logInfo('tools', 'Converter output written', { fileName: location.fileName, bytes: blob.size });
  } catch (error) {
    logError('tools', 'Converter output write failed', { fileName: location.fileName, error });
    throw error;
  }
}

export function converterOutputKey(directories: readonly string[], fileName: string): string {
  return [...directories, fileName].join('/').toLocaleLowerCase();
}
