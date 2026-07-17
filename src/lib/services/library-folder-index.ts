import type { TrackKind } from '$lib/types';
import { inferExtension, inferKind } from '$lib/utils/files';

export interface IndexedFileDescriptor {
  path: string;
  name: string;
  extension: string;
  kind: TrackKind;
}

export interface LibraryFolderIndexError {
  path: string;
  operation: 'iterate';
  message: string;
  recoverable: boolean;
}

export interface EnumerateSupportedFilesOptions {
  maxDepth: number;
  signal?: AbortSignal;
  onDirectory?: (path: string) => void;
  onSkippedFile?: (path: string) => void;
  onError?: (error: LibraryFolderIndexError) => void;
}

function normalizePathPart(value: string): string {
  return value.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '');
}

function safeMessage(error: unknown): string {
  if (error instanceof DOMException && error.name) return error.name;
  if (error instanceof Error && error.message) return error.message;
  return 'The directory could not be read.';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The folder scan was cancelled.', 'AbortError');
  }
}

async function* enumerateDirectory(
  handle: FileSystemDirectoryHandle,
  path: string,
  depth: number,
  options: EnumerateSupportedFilesOptions,
  root: boolean
): AsyncGenerator<IndexedFileDescriptor> {
  throwIfAborted(options.signal);
  options.onDirectory?.(path);

  try {
    for await (const entry of handle.values()) {
      throwIfAborted(options.signal);
      const entryName = normalizePathPart(entry.name);
      const entryPath = `${path}/${entryName}`;

      if (entry.kind === 'directory') {
        if (depth < options.maxDepth) {
          yield* enumerateDirectory(
            entry as FileSystemDirectoryHandle,
            entryPath,
            depth + 1,
            options,
            false
          );
        }
        continue;
      }

      const extension = inferExtension(entryName);
      const kind = inferKind(extension);

      if (!kind) {
        options.onSkippedFile?.(entryPath);
        continue;
      }

      yield {
        path: entryPath,
        name: entryName,
        extension,
        kind
      };
    }
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }

    const indexError: LibraryFolderIndexError = {
      path,
      operation: 'iterate',
      message: safeMessage(error),
      recoverable: !root
    };
    options.onError?.(indexError);

    if (root) throw error;
  }
}

export async function* enumerateSupportedFiles(
  root: FileSystemDirectoryHandle,
  options: EnumerateSupportedFilesOptions
): AsyncGenerator<IndexedFileDescriptor> {
  const rootPath = normalizePathPart(root.name);
  yield* enumerateDirectory(root, rootPath, 0, options, true);
}
