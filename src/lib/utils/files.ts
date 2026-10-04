import {
  MODULE_EXTENSIONS,
  IMAGE_EXTENSIONS,
  STREAM_EXTENSIONS,
  VIDEO_EXTENSIONS,
  type TrackItem,
  type TrackKind,
  type TrackMetadata
} from '$lib/types';
import { getImportedFileSource, normalizePath } from './file-sources';
import { createMediaFileUrl, nativeFileIdentity } from './native-media-files';

const fileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});
const moduleOverrideFiles = new WeakSet<File>();

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

export function markFileAsModule(file: File): void {
  moduleOverrideFiles.add(file);
}

function createTrackObjectUrl(kind: TrackKind, file: File): string | undefined {
  return kind === 'stream' || kind === 'video' ? createMediaFileUrl(file) : undefined;
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

  if (IMAGE_EXTENSIONS.includes(extension as (typeof IMAGE_EXTENSIONS)[number])) {
    return 'image';
  }

  return null;
}

export function isVisualMediaFileName(fileName: string): boolean {
  const kind = inferKind(inferExtension(fileName));
  return kind === 'video' || kind === 'image';
}

function createTrackItem(file: File): TrackItem | null {
  const extension = inferExtension(file.name);
  const kind = inferKind(extension) ?? (moduleOverrideFiles.has(file) ? 'module' : null);

  if (!kind) {
    return null;
  }

  const source = getImportedFileSource(file);
  const retainedFile = source?.fileHandle || source?.nativeFile ? undefined : file;

  return {
    id: crypto.randomUUID(),
    file: retainedFile,
    fileHandle: source?.fileHandle,
    ...(source?.nativeFile ? { nativeFile: source.nativeFile } : {}),
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

export function buildTrackItems(files: FileList | File[]): TrackItem[] {
  const items: TrackItem[] = [];
  const sortedFiles = Array.from(files).sort((left, right) => fileNameCollator.compare(left.name, right.name));

  for (const file of sortedFiles) {
    const item = createTrackItem(file);

    if (item) {
      items.push(item);
    }
  }

  return items;
}

export function getTrackDisplayTitle(item: TrackItem | null): string {
  const title = item?.metadata?.title?.trim();
  return title || (item ? stripFileExtension(item.name) : '');
}

export function getSeparatedSubsongQueueLabel(item: TrackItem | null): string {
  if (!item || item.kind !== 'module' || item.subsong === undefined) {
    return '';
  }

  const count = Math.max(1, Math.trunc(item.metadata?.subsongs ?? 1));
  const subsong = Math.min(Math.max(Math.trunc(item.subsong), 0), count - 1);
  return count > 1 ? `${item.name} - ${subsong + 1}/${count}` : '';
}

export function buildSeparatedSubsongItems(
  item: TrackItem,
  activeSubsong = item.subsong ?? 0
): TrackItem[] {
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

export function getTrackQueueLabel(item: TrackItem | null): string {
  const subsongLabel = getSeparatedSubsongQueueLabel(item);

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

export function getTrackIdentity(item: Pick<TrackItem, 'path' | 'name' | 'size' | 'lastModified' | 'nativeFile'>): string {
  if (item.nativeFile) return `uri:${nativeFileIdentity(item.nativeFile.uri)}`;
  const normalizedPath = normalizePath(item.path)?.toLowerCase();

  if (normalizedPath) {
    return `path:${normalizedPath}`;
  }

  return `file:${item.name.toLowerCase()}:${item.size}:${item.lastModified}`;
}

export function getFavoriteIdentity(
  item: Pick<TrackItem, 'path' | 'name' | 'size' | 'lastModified' | 'subsong' | 'nativeFile'>
): string {
  return `${getTrackIdentity(item)}:subsong:${item.subsong ?? 'all'}`;
}

function cloneTrackItem(item: TrackItem): TrackItem {
  return {
    ...item,
    id: crypto.randomUUID(),
    objectUrl: item.file ? createTrackObjectUrl(item.kind, item.file) : undefined,
    metadata: cloneTrackMetadata(item.metadata)
  };
}

export function cloneTrackItems(items: TrackItem[]): TrackItem[] {
  return items.map(cloneTrackItem);
}

export function getTrackDisplaySubtitle(item: TrackItem | null): string {
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
