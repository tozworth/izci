import { MODULE_EXTENSIONS, STREAM_EXTENSIONS, type PlaylistItem, type TrackKind } from '$lib/types';

const MODULE_TRACKER_NAMES: Record<string, string> = {
  mod: 'SoundTracker compatible',
  xm: 'FastTracker II compatible',
  s3m: 'Scream Tracker 3',
  it: 'Impulse Tracker',
  mptm: 'ModPlug Tracker / OpenMPT'
};

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

export function inferKind(extension: string): TrackKind | null {
  if (STREAM_EXTENSIONS.includes(extension as (typeof STREAM_EXTENSIONS)[number])) {
    return 'stream';
  }

  if (MODULE_EXTENSIONS.includes(extension as (typeof MODULE_EXTENSIONS)[number])) {
    return 'module';
  }

  return null;
}

export function buildPlaylistItems(files: FileList | File[]): PlaylistItem[] {
  const items: PlaylistItem[] = [];

  for (const file of Array.from(files)) {
    const extension = inferExtension(file.name);
    const kind = inferKind(extension);

    if (!kind) {
      continue;
    }

    items.push({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      extension,
      kind,
      size: file.size,
      objectUrl: kind === 'stream' ? URL.createObjectURL(file) : undefined
    });
  }

  return items;
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
