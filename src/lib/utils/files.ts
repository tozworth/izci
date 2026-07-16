import {
  MODULE_EXTENSIONS,
  STREAM_EXTENSIONS,
  type PlaylistItem,
  type TrackKind,
  type TrackMetadata
} from '$lib/types';

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

interface ImportedFileSource {
  fileHandle?: FileSystemFileHandle;
  path?: string;
}

interface DirectoryReadOptions {
  maxDepth?: number;
}

const fileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});
const importedFileSources = new WeakMap<File, ImportedFileSource>();
const moduleOverrideFiles = new WeakSet<File>();

function normalizePath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

export function getFolderFromPath(path: string | undefined): string | undefined {
  const normalizedPath = normalizePath(path);

  if (!normalizedPath) {
    return undefined;
  }

  const separatorIndex = normalizedPath.lastIndexOf('/');
  return separatorIndex > 0 ? normalizedPath.slice(0, separatorIndex) : undefined;
}

function cloneTrackMetadata(metadata: TrackMetadata | undefined): TrackMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  return {
    ...metadata,
    subsongNames: metadata.subsongNames ? [...metadata.subsongNames] : undefined
  };
}

function registerImportedFile(file: File, source: ImportedFileSource): File {
  const existing = importedFileSources.get(file);

  importedFileSources.set(file, {
    fileHandle: source.fileHandle ?? existing?.fileHandle,
    path: normalizePath(source.path) ?? existing?.path
  });

  return file;
}

function getImportedFileSource(file: File): ImportedFileSource | undefined {
  return importedFileSources.get(file);
}

export function markFileAsModule(file: File): void {
  moduleOverrideFiles.add(file);
}

function createTrackObjectUrl(kind: TrackKind, file: File): string | undefined {
  return kind === 'stream' ? URL.createObjectURL(file) : undefined;
}

export function inferExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1)! : '';
}

export function stripFileExtension(fileName: string): string {
  const extension = inferExtension(fileName);

  if (!extension) {
    return fileName;
  }

  const suffix = `.${extension}`;

  return fileName.toLowerCase().endsWith(suffix) ? fileName.slice(0, -suffix.length) : fileName;
}

export function inferArtistTitleFromFileName(fileName: string): { artist: string; title: string } | null {
  const baseName = stripFileExtension(fileName).trim();
  const separatorIndex = baseName.indexOf(' - ');

  if (separatorIndex <= 0 || separatorIndex >= baseName.length - 3) {
    return null;
  }

  const artist = baseName.slice(0, separatorIndex).trim();
  const title = baseName.slice(separatorIndex + 3).trim();

  if (!artist || !title) {
    return null;
  }

  return { artist, title };
}

export function mergeInferredArtistTitle(metadata: TrackMetadata = {}, fileName: string, enabled = true): TrackMetadata {
  if (!enabled) {
    return metadata;
  }

  const hasTitle = typeof metadata.title === 'string' && metadata.title.trim() !== '';
  const hasArtist = typeof metadata.artist === 'string' && metadata.artist.trim() !== '';

  if (hasTitle && hasArtist) {
    return metadata;
  }

  const inferred = inferArtistTitleFromFileName(fileName);

  if (!inferred) {
    return metadata;
  }

  return {
    ...metadata,
    title: hasTitle ? metadata.title : inferred.title,
    artist: hasArtist ? metadata.artist : inferred.artist
  };
}

export function inferKind(extension: string): TrackKind | null {
  if (STREAM_EXTENSIONS.includes(extension as (typeof STREAM_EXTENSIONS)[number])) {
    return 'stream';
  }

  if (MODULE_EXTENSIONS.includes(extension as (typeof MODULE_EXTENSIONS)[number])) {
    return 'module';
  }

  return null;
}

function createPlaylistItem(file: File): PlaylistItem | null {
  const extension = inferExtension(file.name);
  const kind = inferKind(extension) ?? (moduleOverrideFiles.has(file) ? 'module' : null);

  if (!kind) {
    return null;
  }

  const source = getImportedFileSource(file);

  return {
    id: crypto.randomUUID(),
    file,
    fileHandle: source?.fileHandle,
    path: source?.path,
    name: file.name,
    extension,
    kind,
    size: file.size,
    lastModified: file.lastModified,
    objectUrl: createTrackObjectUrl(kind, file)
  };
}

export function buildPlaylistItems(files: FileList | File[]): PlaylistItem[] {
  const items: PlaylistItem[] = [];
  const sortedFiles = Array.from(files).sort((left, right) => fileNameCollator.compare(left.name, right.name));

  for (const file of sortedFiles) {
    const item = createPlaylistItem(file);

    if (item) {
      items.push(item);
    }
  }

  return items;
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
  path = handle.name,
  depth = 0
): Promise<File[]> {
  const files: File[] = [];
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;

  for await (const entry of handle.values()) {
    if (entry.kind === 'file') {
      const fileHandle = entry as FileSystemFileHandle;
      files.push(await readFileHandle(fileHandle, `${path}/${fileHandle.name}`));
    } else if (entry.kind === 'directory' && depth < maxDepth) {
      const directoryHandle = entry as FileSystemDirectoryHandle;
      files.push(
        ...(await readDirectoryFiles(
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

export async function readFileHandleFiles(handles: FileSystemFileHandle[]): Promise<File[]> {
  return await Promise.all(handles.map((handle) => readFileHandle(handle)));
}

export async function extractDroppedFiles(
  dataTransfer: DataTransfer,
  options: DirectoryReadOptions = {}
): Promise<File[]> {
  const files: File[] = [];
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

  for (const item of Array.from(dataTransfer.items)) {
    const handle = await item.getAsFileSystemHandle?.();

    if (handle?.kind === 'file') {
      pushFile(await readFileHandle(handle as FileSystemFileHandle));
      continue;
    }

    if (handle?.kind === 'directory') {
      const directoryFiles = await readDirectoryFiles(handle as FileSystemDirectoryHandle, options);

      for (const file of directoryFiles) {
        pushFile(file);
      }

      continue;
    }

    const entry = (item as ChromiumDataTransferItem).webkitGetAsEntry?.();

    if (!entry) {
      pushFile(item.getAsFile());
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
    return files;
  }

  for (const file of Array.from(dataTransfer.files)) {
    pushFile(file);
  }

  return files;
}

export function getTrackDisplayTitle(item: PlaylistItem | null): string {
  const title = item?.metadata?.title?.trim();
  return title || (item ? stripFileExtension(item.name) : '');
}

export function getTrackPlaylistLabel(item: PlaylistItem | null): string {
  const title = getTrackDisplayTitle(item);
  const artist = getTrackDisplaySubtitle(item);

  if (!artist) {
    return title;
  }

  return title ? `${artist} - ${title}` : artist;
}

export function getTrackIdentity(item: Pick<PlaylistItem, 'path' | 'name' | 'size' | 'lastModified'>): string {
  const normalizedPath = normalizePath(item.path)?.toLowerCase();

  if (normalizedPath) {
    return `path:${normalizedPath}`;
  }

  return `file:${item.name.toLowerCase()}:${item.size}:${item.lastModified}`;
}

export function clonePlaylistItem(item: PlaylistItem): PlaylistItem {
  return {
    ...item,
    id: crypto.randomUUID(),
    objectUrl: item.file ? createTrackObjectUrl(item.kind, item.file) : undefined,
    metadata: cloneTrackMetadata(item.metadata)
  };
}

export function clonePlaylistItems(items: PlaylistItem[]): PlaylistItem[] {
  return items.map(clonePlaylistItem);
}

export function getTrackDisplaySubtitle(item: PlaylistItem | null): string {
  const artist = item?.metadata?.artist?.trim();

  if (artist && artist.toLowerCase() !== 'unknown') {
    return artist;
  }

  return '';
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }

  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;

  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function resolveModuleTrackerName(_extension: string, trackerType?: string): string {
  return trackerType?.trim() ?? '';
}

export function resolveModuleDisplayFormat(extension: string, metadata?: TrackMetadata): string {
  const normalizedExtension = extension.trim().toLowerCase();
  const normalizedOriginalType = metadata?.originalType?.trim().toLowerCase();

  if (
    normalizedOriginalType &&
    normalizedOriginalType !== normalizedExtension &&
    MODULE_EXTENSIONS.includes(normalizedOriginalType as (typeof MODULE_EXTENSIONS)[number])
  ) {
    return `${normalizedOriginalType.toUpperCase()} in ${normalizedExtension.toUpperCase()} container`;
  }

  return normalizedExtension.toUpperCase();
}
