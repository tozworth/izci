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
  webkitGetAsEntry?: () => ChromiumFileSystemEntry | null;
};

const MODULE_TRACKER_NAMES: Record<string, string> = {
  mod: 'SoundTracker compatible',
  xm: 'FastTracker II compatible',
  s3m: 'Scream Tracker 3',
  it: 'Impulse Tracker',
  mptm: 'ModPlug Tracker / OpenMPT'
};

const fileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

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
  const kind = inferKind(extension);

  if (!kind) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    extension,
    kind,
    size: file.size,
    objectUrl: kind === 'stream' ? URL.createObjectURL(file) : undefined
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

function readDirectoryBatch(reader: ChromiumDirectoryReader): Promise<ChromiumFileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function readDirectoryEntrySurfaceFiles(entry: ChromiumDirectoryEntry): Promise<File[]> {
  const reader = entry.createReader();
  const files: File[] = [];

  while (true) {
    const entries = await readDirectoryBatch(reader);

    if (entries.length === 0) {
      break;
    }

    for (const child of entries) {
      if (child.isFile) {
        files.push(await readFileEntry(child as ChromiumFileEntry));
      }
    }
  }

  return files;
}

export async function readDirectorySurfaceFiles(handle: FileSystemDirectoryHandle): Promise<File[]> {
  const files: File[] = [];

  for await (const entry of handle.values()) {
    if (entry.kind === 'file') {
      files.push(await (entry as FileSystemFileHandle).getFile());
    }
  }

  return files;
}

export async function extractDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const seen = new Set<string>();

  const pushFile = (file: File | null) => {
    if (!file) {
      return;
    }

    const key = `${file.name}:${file.size}:${file.lastModified}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    files.push(file);
  };

  for (const item of Array.from(dataTransfer.items)) {
    const entry = (item as ChromiumDataTransferItem).webkitGetAsEntry?.();

    if (!entry) {
      pushFile(item.getAsFile());
      continue;
    }

    if (entry.isFile) {
      pushFile(await readFileEntry(entry as unknown as ChromiumFileEntry));
      continue;
    }

    if (entry.isDirectory) {
      const directoryFiles = await readDirectoryEntrySurfaceFiles(entry as unknown as ChromiumDirectoryEntry);

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

export function getTrackDisplaySubtitle(item: PlaylistItem | null): string {
  const artist = item?.metadata?.artist?.trim();

  if (artist && artist.toLowerCase() !== 'unknown') {
    return artist;
  }

  return '';
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
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

export function truncateMiddle(value: string, maxLength = 34): string {
  if (value.length <= maxLength) {
    return value;
  }

  const keep = maxLength - 1;
  const start = Math.ceil(keep / 2);
  const end = Math.floor(keep / 2);

  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function resolveModuleTrackerName(extension: string, trackerType?: string): string {
  const normalizedExtension = extension.trim().toLowerCase();
  const normalizedTrackerType = trackerType?.trim();

  if (normalizedTrackerType && normalizedTrackerType.toLowerCase() !== normalizedExtension) {
    return normalizedTrackerType;
  }

  return MODULE_TRACKER_NAMES[normalizedExtension] ?? normalizedTrackerType ?? '';
}
