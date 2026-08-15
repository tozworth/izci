import type { TrackItem } from '$lib/types';

export interface PlaybackBookmark {
  id: string;
  name: string;
  time: number;
}

const STORAGE_KEY = 'izci-playback-bookmarks';

type BookmarkStorage = Record<string, PlaybackBookmark[]>;

export function getPlaybackBookmarkFileKey(track: TrackItem): string {
  if (track.path) return `path:${track.path}`;
  return `file:${track.name}\u0000${track.size}\u0000${track.lastModified}`;
}

export function normalizePlaybackBookmarks(value: unknown): PlaybackBookmark[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Partial<PlaybackBookmark>;
    if (typeof source.id !== 'string' || !source.id || typeof source.name !== 'string') return [];
    if (typeof source.time !== 'number' || !Number.isFinite(source.time) || source.time < 0) return [];
    return [{ id: source.id, name: source.name.trim() || 'Bookmark', time: source.time }];
  }).sort((left, right) => left.time - right.time);
}

function readStorage(): BookmarkStorage {
  if (typeof localStorage === 'undefined') return {};
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeStorage(value: BookmarkStorage): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Bookmarks remain usable for this menu interaction when storage is unavailable.
  }
}

export function getPlaybackBookmarks(track: TrackItem): PlaybackBookmark[] {
  return normalizePlaybackBookmarks(readStorage()[getPlaybackBookmarkFileKey(track)]);
}

export function addPlaybackBookmark(
  track: TrackItem,
  time: number,
  requestedName: string
): PlaybackBookmark[] {
  const storage = readStorage();
  const key = getPlaybackBookmarkFileKey(track);
  const bookmarks = normalizePlaybackBookmarks(storage[key]);
  const usedNumbers = new Set(bookmarks.flatMap((bookmark) => {
    const match = /^Bookmark (\d+)$/.exec(bookmark.name);
    return match ? [Number(match[1])] : [];
  }));
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;

  bookmarks.push({
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    name: requestedName.trim() || `Bookmark ${nextNumber}`,
    time: Math.max(0, Number.isFinite(time) ? time : 0)
  });
  bookmarks.sort((left, right) => left.time - right.time);
  storage[key] = bookmarks;
  writeStorage(storage);
  return bookmarks;
}

export function deletePlaybackBookmark(track: TrackItem, bookmarkId: string): PlaybackBookmark[] {
  const storage = readStorage();
  const key = getPlaybackBookmarkFileKey(track);
  const bookmarks = normalizePlaybackBookmarks(storage[key]).filter(({ id }) => id !== bookmarkId);
  if (bookmarks.length > 0) storage[key] = bookmarks;
  else delete storage[key];
  writeStorage(storage);
  return bookmarks;
}
