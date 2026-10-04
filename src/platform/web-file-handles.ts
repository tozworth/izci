import { registerImportedFile, getImportedFileSource, normalizePath } from '$lib/utils/file-sources';
import type { ImportedFileSource } from '$lib/utils/file-sources';

interface ChromiumFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}

interface ChromiumFileEntry extends ChromiumFileSystemEntry {
  isFile: true;
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
}

interface ChromiumDirectoryEntry extends ChromiumFileSystemEntry {
  isDirectory: true;
  createReader: () => ChromiumDirectoryReader;
}

interface ChromiumDirectoryReader {
  readEntries: (
    successCallback: (entries: ChromiumFileSystemEntry[]) => void,
    errorCallback?: (error: DOMException) => void
  ) => void;
}

type ChromiumDataTransferItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
  webkitGetAsEntry?: () => ChromiumFileSystemEntry | null;
};

function readDroppedHandle(item: DataTransferItem): Promise<FileSystemHandle | null> {
  try { return item.getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null); }
  catch { return Promise.resolve(null); }
}

type FileHandleSourceResolver = (
  handle: FileSystemFileHandle
) => ImportedFileSource | undefined | Promise<ImportedFileSource | undefined>;

export interface DirectoryReadOptions {
  maxDepth?: number;
  readConcurrency?: number;
}

export interface DirectoryDiscoveryOptions {
  maxDepth?: number;
  onFileFound?: (file: DiscoveredDirectoryFile) => void;
}

export interface DiscoveredDirectoryFile {
  fileHandle: FileSystemFileHandle;
  parentHandle: FileSystemDirectoryHandle;
  path: string;
}

function readFileEntry(entry: ChromiumFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readFileHandle(handle: FileSystemFileHandle, path = handle.name): Promise<File> {
  const file = await handle.getFile();
  return registerImportedFile(file, {
    fileHandle: handle,
    path
  });
}

function readDirectoryBatch(reader: ChromiumDirectoryReader): Promise<ChromiumFileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function readDirectoryEntryFiles(
  entry: ChromiumDirectoryEntry,
  maxDepth: number,
  depth = 0
): Promise<File[]> {
  const reader = entry.createReader();
  const files: File[] = [];

  while (true) {
    const entries = await readDirectoryBatch(reader);

    if (entries.length === 0) {
      break;
    }

    for (const child of entries) {
      if (child.isFile) {
        const file = await readFileEntry(child as ChromiumFileEntry);
        files.push(
          registerImportedFile(file, {
            path: normalizePath(child.fullPath)
          })
        );
      } else if (child.isDirectory && depth < maxDepth) {
        files.push(
          ...(await readDirectoryEntryFiles(child as ChromiumDirectoryEntry, maxDepth, depth + 1))
        );
      }
    }
  }

  return files;
}

export async function readDirectoryFiles(
  handle: FileSystemDirectoryHandle,
  options: DirectoryReadOptions = {},
  path = handle.name
): Promise<File[]> {
  const discovered = await discoverDirectoryFilesAtPath(handle, options, path);
  const files = new Array<File>(discovered.length);
  let index = 0;
  const workerCount = Math.min(
    Math.max(1, Math.trunc(options.readConcurrency ?? 16)),
    discovered.length
  );

  const workers = Array.from({ length: workerCount }, async () => {
    while (index < discovered.length) {
      const currentIndex = index++;
      const current = discovered[currentIndex];
      files[currentIndex] = registerImportedFile(await readFileHandle(current.fileHandle, current.path), { parentHandle: current.parentHandle });
    }
  });

  await Promise.all(workers);
  return files;
}

export async function discoverDirectoryFiles(
  handle: FileSystemDirectoryHandle,
  options: DirectoryDiscoveryOptions = {}
): Promise<DiscoveredDirectoryFile[]> {
  return await discoverDirectoryFilesAtPath(handle, options, handle.name);
}

async function discoverDirectoryFilesAtPath(
  handle: FileSystemDirectoryHandle,
  options: DirectoryDiscoveryOptions,
  path: string,
  depth = 0
): Promise<DiscoveredDirectoryFile[]> {
  const files: DiscoveredDirectoryFile[] = [];
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;

  for await (const entry of handle.values()) {
    if (entry.kind === 'file') {
      const fileHandle = entry as FileSystemFileHandle;
      const file = {
        fileHandle,
        parentHandle: handle,
        path: `${path}/${fileHandle.name}`
      };
      files.push(file);
      options.onFileFound?.(file);
    } else if (entry.kind === 'directory' && depth < maxDepth) {
      const directoryHandle = entry as FileSystemDirectoryHandle;
      files.push(
        ...(await discoverDirectoryFilesAtPath(
          directoryHandle,
          options,
          `${path}/${directoryHandle.name}`,
          depth + 1
        ))
      );
    }
  }

  return files;
}

export async function readFileHandleFiles(
  handles: FileSystemFileHandle[],
  resolveSource?: FileHandleSourceResolver
): Promise<File[]> {
  return await Promise.all(
    handles.map(async (handle) => {
      const source = await resolveSource?.(handle);
      const file = await readFileHandle(handle, source?.path ?? handle.name);
      return registerImportedFile(file, {
        ...source,
        fileHandle: handle
      });
    })
  );
}

export interface DroppedContent {
  files: File[];
  directoryHandles: FileSystemDirectoryHandle[];
}

export async function extractDroppedContent(
  dataTransfer: DataTransfer,
  options: DirectoryReadOptions = {}
): Promise<DroppedContent> {
  const files: File[] = [];
  const directoryHandles: FileSystemDirectoryHandle[] = [];
  const fallbackFiles = Array.from(dataTransfer.files);
  const seen = new Set<string>();

  const pushFile = (file: File | null, source: ImportedFileSource = {}) => {
    if (!file) {
      return;
    }

    registerImportedFile(file, source);

    const normalizedPath = normalizePath(source.path) ?? getImportedFileSource(file)?.path ?? file.name;
    const key = `${normalizedPath}:${file.size}:${file.lastModified}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    files.push(file);
  };

  // Capture handles and legacy entries before asynchronous I/O consumes the
  // drag data store's event lifetime. A partial handle API can still fall back.
  const dropped = Array.from(dataTransfer.items).map(item => ({
    handle: readDroppedHandle(item),
    entry: (item as ChromiumDataTransferItem).webkitGetAsEntry?.(),
    file: item.getAsFile?.()
  }));
  for (const item of dropped) {
    const handle = await item.handle;

    if (handle?.kind === 'file') {
      pushFile(await readFileHandle(handle as FileSystemFileHandle));
      continue;
    }

    if (handle?.kind === 'directory') {
      const directoryHandle = handle as FileSystemDirectoryHandle;
      directoryHandles.push(directoryHandle);
      const directoryFiles = await readDirectoryFiles(directoryHandle, options);

      for (const file of directoryFiles) {
        pushFile(file);
      }

      continue;
    }

    const entry = item.entry;

    if (!entry) {
      pushFile(item.file ?? null);
      continue;
    }

    if (entry.isFile) {
      pushFile(await readFileEntry(entry as unknown as ChromiumFileEntry), {
        path: normalizePath(entry.fullPath)
      });
      continue;
    }

    if (entry.isDirectory) {
      const directoryFiles = await readDirectoryEntryFiles(
        entry as unknown as ChromiumDirectoryEntry,
        options.maxDepth ?? Number.POSITIVE_INFINITY
      );

      for (const file of directoryFiles) {
        pushFile(file);
      }
    }
  }

  if (files.length > 0) {
    return { files, directoryHandles };
  }

  for (const file of fallbackFiles) {
    pushFile(file);
  }

  return { files, directoryHandles };
}

export async function extractDroppedFiles(
  dataTransfer: DataTransfer,
  options: DirectoryReadOptions = {}
): Promise<File[]> {
  return (await extractDroppedContent(dataTransfer, options)).files;
}

export async function getDroppedDirectoryHandles(dataTransfer: DataTransfer): Promise<FileSystemDirectoryHandle[]> {
  const handles: FileSystemDirectoryHandle[] = [];
  // Start every handle request while the drag data store is still readable.
  const requests = Array.from(dataTransfer.items).map(readDroppedHandle);
  for (const request of requests) {
    try {
      const handle = await request;
      if (handle?.kind === 'directory') handles.push(handle as FileSystemDirectoryHandle);
    } catch { /* Legacy drops can supply Files, but no reusable directory grant. */ }
  }
  return handles;
}

