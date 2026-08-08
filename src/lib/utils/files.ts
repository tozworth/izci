import {
  MODULE_EXTENSIONS,
  STREAM_EXTENSIONS,
  VIDEO_EXTENSIONS,
  type PlaylistItem,
  type TrackKind,
  type TrackMetadata
} from '$lib/types';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';

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
  sourceFolderId?: string;
}

export type FileHandleSourceResolver = (
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
    path: normalizePath(source.path) ?? existing?.path,
    sourceFolderId: source.sourceFolderId ?? existing?.sourceFolderId
  });

  logDebug('files', 'Imported file registered', {
    name: file.name,
    size: file.size,
    kind: inferKind(inferExtension(file.name))
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
  return kind === 'stream' || kind === 'video' ? URL.createObjectURL(file) : undefined;
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

  if (VIDEO_EXTENSIONS.includes(extension as (typeof VIDEO_EXTENSIONS)[number])) {
    return 'video';
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
  const retainedFile = source?.fileHandle ? undefined : file;

  return {
    id: crypto.randomUUID(),
    file: retainedFile,
    fileHandle: source?.fileHandle,
    path: source?.path,
    sourceFolderId: source?.sourceFolderId,
    name: file.name,
    extension,
    kind,
    size: file.size,
    lastModified: file.lastModified,
    objectUrl: retainedFile ? createTrackObjectUrl(kind, retainedFile) : undefined
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
  let file: File;
  try {
    file = await handle.getFile();
  } catch (error) {
    logError('files', 'Failed to read file handle', {
      name: handle.name,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
  logDebug('files', 'File handle read', { name: file.name, size: file.size });
  return registerImportedFile(file, {
    fileHandle: handle,
    path
  });
}

/**
 * Requests persistent read access to a File System Access handle. The picker
 * grants implicit read access, but that grant does not reliably survive a
 * reload (state can come back 'prompt'), silently breaking handle-only
 * materialization — e.g. host-side Freeplay playback, where no user gesture
 * exists to prompt. Import flows run inside a user gesture, so an explicit
 * request here makes the grant stick.
 */
export async function ensureFileHandleReadPermission(
  handle: FileSystemHandle
): Promise<FileSystemPermissionState> {
  if (typeof handle.queryPermission !== 'function' || typeof handle.requestPermission !== 'function') {
    return 'granted';
  }
  try {
    const queried = await handle.queryPermission({ mode: 'read' });
    if (queried === 'granted') {
      logDebug('files', 'File handle read permission granted', { name: handle.name });
      return 'granted';
    }
    const requested = await handle.requestPermission({ mode: 'read' });
    if (requested === 'granted') {
      logDebug('files', 'File handle read permission granted', { name: handle.name });
    } else {
      logWarning(
        'files',
        'File handle read permission not granted — handle-only materialization may silently fail',
        { name: handle.name, state: requested }
      );
    }
    return requested;
  } catch (error) {
    logWarning('files', 'File handle read permission unavailable', {
      name: handle.name,
      error: error instanceof Error ? error.message : String(error)
    });
    return 'denied';
  }
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
  logInfo('files', 'Reading directory files', { name: handle.name });

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
      files[currentIndex] = await readFileHandle(current.fileHandle, current.path);
    }
  });

  await Promise.all(workers);
  logInfo('files', 'Directory read completed', { name: handle.name, files: files.length });
  return files;
}

export async function discoverDirectoryFiles(
  handle: FileSystemDirectoryHandle,
  options: DirectoryDiscoveryOptions = {}
): Promise<DiscoveredDirectoryFile[]> {
  const files = await discoverDirectoryFilesAtPath(handle, options, handle.name);
  logInfo('files', 'Directory discovery completed', { name: handle.name, discovered: files.length });
  return files;
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
  const files = await Promise.all(
    handles.map(async (handle) => {
      const source = await resolveSource?.(handle);
      const file = await readFileHandle(handle, source?.path ?? handle.name);
      return registerImportedFile(file, {
        ...source,
        fileHandle: handle
      });
    })
  );
  logInfo('files', 'File handle batch read completed', { count: files.length });
  return files;
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
      const directoryHandle = handle as FileSystemDirectoryHandle;
      directoryHandles.push(directoryHandle);
      const directoryFiles = await readDirectoryFiles(directoryHandle, options);

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
    logInfo('files', 'Dropped content extracted', {
      files: files.length,
      directoryHandles: directoryHandles.length
    });
    return { files, directoryHandles };
  }

  for (const file of Array.from(dataTransfer.files)) {
    pushFile(file);
  }

  logInfo('files', 'Dropped content extracted', {
    files: files.length,
    directoryHandles: directoryHandles.length
  });
  return { files, directoryHandles };
}

export async function extractDroppedFiles(
  dataTransfer: DataTransfer,
  options: DirectoryReadOptions = {}
): Promise<File[]> {
  return (await extractDroppedContent(dataTransfer, options)).files;
}

export function getTrackDisplayTitle(item: PlaylistItem | null): string {
  const title = item?.metadata?.title?.trim();
  return title || (item ? stripFileExtension(item.name) : '');
}

export function getSeparatedSubsongPlaylistLabel(item: PlaylistItem | null): string {
  if (!item || item.kind !== 'module' || item.subsong === undefined) {
    return '';
  }

  const count = Math.max(1, Math.trunc(item.metadata?.subsongs ?? 1));
  const subsong = Math.min(Math.max(Math.trunc(item.subsong), 0), count - 1);
  return count > 1 ? `${item.name} - ${subsong + 1}/${count}` : '';
}

export function buildSeparatedSubsongItems(
  item: PlaylistItem,
  activeSubsong = item.subsong ?? 0
): PlaylistItem[] {
  const count = Math.max(1, Math.trunc(item.metadata?.subsongs ?? 1));
  const preservedSubsong = Math.min(Math.max(Math.trunc(activeSubsong), 0), count - 1);

  return Array.from({ length: count }, (_, subsong) => ({
    ...item,
    id: subsong === preservedSubsong ? item.id : crypto.randomUUID(),
    objectUrl: undefined,
    metadata: cloneTrackMetadata(item.metadata),
    subsong
  }));
}

export function getTrackPlaylistLabel(item: PlaylistItem | null): string {
  const subsongLabel = getSeparatedSubsongPlaylistLabel(item);

  if (subsongLabel) {
    return subsongLabel;
  }

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

export function getFavoriteIdentity(
  item: Pick<PlaylistItem, 'path' | 'name' | 'size' | 'lastModified' | 'subsong'>
): string {
  return `${getTrackIdentity(item)}:subsong:${item.subsong ?? 'all'}`;
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
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const clock = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return hours > 0 ? `${String(hours).padStart(2, '0')}:${clock}` : clock;
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
