import { MODULE_EXTENSIONS, type TrackKind } from '$lib/contracts/media-format';
import { type MediaEntity } from '$lib/contracts/catalog';
import { type TrackMetadata } from '$lib/contracts/media-metadata';
import { inferMediaExtension, inferTrackKind } from '$lib/media/format-policy';
import { mediaSources } from '$lib/media/media-source';

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
  signal?: AbortSignal;
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

  return file;
}

function getImportedFileSource(file: File): ImportedFileSource | undefined {
  return importedFileSources.get(file);
}

export function markFileAsModule(file: File): void {
  moduleOverrideFiles.add(file);
}

export function stripFileExtension(fileName: string): string {
  const extension = inferMediaExtension(fileName);

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

function createMediaEntity(file: File, createId: () => string): MediaEntity | null {
  const format = inferMediaExtension(file.name);
  const kind = inferTrackKind(format) ?? (moduleOverrideFiles.has(file) ? 'module' : null);

  if (!kind) {
    return null;
  }

  const source = getImportedFileSource(file);
  const id = createId();
  mediaSources.register({
    entityId: id,
    file,
    ...(source?.fileHandle ? { fileHandle: source.fileHandle } : {}),
    permission: 'granted'
  });

  return {
    id,
    path: normalizePath(source?.path) ?? file.name,
    sourceFolderId: source?.sourceFolderId,
    name: file.name,
    format,
    kind,
    size: file.size,
    lastModified: file.lastModified
  };
}

export function buildMediaEntities(
  files: FileList | File[],
  options: { createId?: () => string } = {}
): MediaEntity[] {
  const items: MediaEntity[] = [];
  const sortedFiles = Array.from(files).sort((left, right) => fileNameCollator.compare(left.name, right.name));

  for (const file of sortedFiles) {
    const item = createMediaEntity(file, options.createId ?? (() => crypto.randomUUID()));

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
      files[currentIndex] = await readFileHandle(current.fileHandle, current.path);
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
  const iterator = handle.values()[Symbol.asyncIterator]();
  const abortReason = () => options.signal?.reason ?? new DOMException('Directory discovery cancelled.', 'AbortError');
  const nextEntry = async (): Promise<IteratorResult<FileSystemHandle>> => {
    if (options.signal?.aborted) throw abortReason();
    if (!options.signal) return iterator.next();
    return await new Promise((resolve, reject) => {
      const handleAbort = () => reject(abortReason());
      options.signal!.addEventListener('abort', handleAbort, { once: true });
      void iterator.next().then(resolve, reject).finally(() => {
        options.signal!.removeEventListener('abort', handleAbort);
      });
    });
  };

  try {
    for (let next = await nextEntry(); !next.done; next = await nextEntry()) {
      const entry = next.value;
      if (options.signal?.aborted) throw abortReason();
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
  } finally {
    void iterator.return?.().catch(() => undefined);
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
    return { files, directoryHandles };
  }

  for (const file of Array.from(dataTransfer.files)) {
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

export function getTrackDisplayTitle(item: MediaEntity | null): string {
  const title = item?.metadata?.title?.trim();
  return title || (item ? stripFileExtension(item.name) : '');
}

export function getSeparatedSubsongPlaylistLabel(item: MediaEntity | null): string {
  if (!item || item.kind !== 'module' || item.subsong === undefined) {
    return '';
  }

  const count = Math.max(1, Math.trunc(item.metadata?.subsongs ?? 1));
  const subsong = Math.min(Math.max(Math.trunc(item.subsong), 0), count - 1);
  return count > 1 ? `${item.name} - ${subsong + 1}/${count}` : '';
}

export function buildSeparatedSubsongItems(
  item: MediaEntity,
  activeSubsong = item.subsong ?? 0
): MediaEntity[] {
  const count = Math.max(1, Math.trunc(item.metadata?.subsongs ?? 1));
  const preservedSubsong = Math.min(Math.max(Math.trunc(activeSubsong), 0), count - 1);

  return Array.from({ length: count }, (_, subsong) => {
    const id = subsong === preservedSubsong ? item.id : crypto.randomUUID();
    if (id !== item.id) mediaSources.clone(item.id, id);
    return {
      ...item,
      id,
      metadata: cloneTrackMetadata(item.metadata),
      subsong
    };
  });
}

export function getTrackPlaylistLabel(item: MediaEntity | null): string {
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

export function getTrackIdentity(item: Pick<MediaEntity, 'path' | 'name' | 'size' | 'lastModified'>): string {
  const normalizedPath = normalizePath(item.path)?.toLowerCase();

  if (normalizedPath) {
    return `path:${normalizedPath}`;
  }

  return `file:${item.name.toLowerCase()}:${item.size}:${item.lastModified}`;
}

export function getFavoriteIdentity(
  item: Pick<MediaEntity, 'path' | 'name' | 'size' | 'lastModified' | 'subsong'>
): string {
  return `${getTrackIdentity(item)}:subsong:${item.subsong ?? 'all'}`;
}

export function cloneMediaEntity(item: MediaEntity): MediaEntity {
  const clone = {
    ...item,
    id: crypto.randomUUID(),
    metadata: cloneTrackMetadata(item.metadata)
  };
  mediaSources.clone(item.id, clone.id);
  return clone;
}

export function cloneMediaEntities(items: MediaEntity[]): MediaEntity[] {
  return items.map(cloneMediaEntity);
}

export function getTrackDisplaySubtitle(item: MediaEntity | null): string {
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

export function resolveModuleDisplayFormat(format: string, metadata?: TrackMetadata): string {
  const normalizedExtension = format.trim().toLowerCase();
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
