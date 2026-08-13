import type { MediaEntity } from '$lib/contracts/catalog';
import { BrowserId } from '$lib/runtime/adapters/browser-id';
import { createPersistentStore } from '$lib/settings/store';

export interface PlaybackBookmark {
  readonly id: string;
  readonly name: string;
  readonly time: number;
}

export interface PlaybackBookmarkBucket {
  readonly key: string;
  readonly bookmarks: readonly PlaybackBookmark[];
  readonly updatedAt: number;
}

export interface PlaybackBookmarkState {
  readonly buckets: readonly PlaybackBookmarkBucket[];
}

export interface PlaybackBookmarkMutationOptions {
  readonly createId?: () => string;
  readonly now?: () => number;
}

export const PLAYBACK_BOOKMARKS_STORAGE_KEY = 'izci-playback-bookmarks';
export const PLAYBACK_BOOKMARKS_CHANNEL = 'izci-playback-bookmarks';
export const MAX_BOOKMARK_TRACKS = 512;
export const MAX_BOOKMARKS_PER_TRACK = 256;

const DEFAULT_STATE: PlaybackBookmarkState = { buckets: [] };

export function getPlaybackBookmarkFileKey(track: MediaEntity): string {
  return `path:${track.path}`;
}

export function normalizePlaybackBookmarks(value: unknown): PlaybackBookmark[] {
  if (!Array.isArray(value)) return [];

  const ids = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Partial<PlaybackBookmark>;
    if (typeof source.id !== 'string' || !source.id || ids.has(source.id)) return [];
    if (typeof source.name !== 'string') return [];
    if (typeof source.time !== 'number' || !Number.isFinite(source.time) || source.time < 0) return [];
    ids.add(source.id);
    return [{ id: source.id, name: source.name.trim() || 'Bookmark', time: source.time }];
  }).sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))
    .slice(0, MAX_BOOKMARKS_PER_TRACK);
}

export function normalizePlaybackBookmarkState(value: unknown): PlaybackBookmarkState {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Partial<PlaybackBookmarkState>).buckets)) {
    return DEFAULT_STATE;
  }
  const keys = new Set<string>();
  const buckets = (value as Partial<PlaybackBookmarkState>).buckets!.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Partial<PlaybackBookmarkBucket>;
    if (typeof source.key !== 'string' || !source.key || keys.has(source.key)) return [];
    const bookmarks = normalizePlaybackBookmarks(source.bookmarks);
    if (bookmarks.length === 0) return [];
    keys.add(source.key);
    return [{
      key: source.key,
      bookmarks,
      updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt)
        ? Math.max(0, source.updatedAt)
        : 0
    }];
  }).sort((left, right) => right.updatedAt - left.updatedAt || left.key.localeCompare(right.key))
    .slice(0, MAX_BOOKMARK_TRACKS);
  return { buckets };
}

export const playbackBookmarksStore = createPersistentStore({
  storageKey: PLAYBACK_BOOKMARKS_STORAGE_KEY,
  channelName: PLAYBACK_BOOKMARKS_CHANNEL,
  defaultValue: DEFAULT_STATE,
  normalize: normalizePlaybackBookmarkState
});

function findBookmarks(key: string): PlaybackBookmark[] {
  return [...(playbackBookmarksStore.getSnapshot().buckets.find((bucket) => bucket.key === key)?.bookmarks ?? [])];
}

function defaultBookmarkId(): string {
  return new BrowserId(globalThis.crypto).create();
}

export function getPlaybackBookmarks(track: MediaEntity): PlaybackBookmark[] {
  return findBookmarks(getPlaybackBookmarkFileKey(track));
}

export function addPlaybackBookmark(
  track: MediaEntity,
  time: number,
  requestedName: string,
  options: PlaybackBookmarkMutationOptions = {}
): PlaybackBookmark[] {
  const key = getPlaybackBookmarkFileKey(track);
  const bookmarks = findBookmarks(key);
  const usedNumbers = new Set(bookmarks.flatMap((bookmark) => {
    const match = /^Bookmark (\d+)$/.exec(bookmark.name);
    return match ? [Number(match[1])] : [];
  }));
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;

  bookmarks.push({
    id: (options.createId ?? defaultBookmarkId)(),
    name: requestedName.trim() || `Bookmark ${nextNumber}`,
    time: Math.max(0, Number.isFinite(time) ? time : 0)
  });
  const normalized = normalizePlaybackBookmarks(bookmarks);
  const updatedAt = (options.now ?? Date.now)();
  playbackBookmarksStore.update((state) => ({
    buckets: [
      { key, bookmarks: normalized, updatedAt },
      ...state.buckets.filter((bucket) => bucket.key !== key)
    ].slice(0, MAX_BOOKMARK_TRACKS)
  }));
  return normalized;
}

export function deletePlaybackBookmark(track: MediaEntity, bookmarkId: string): PlaybackBookmark[] {
  const key = getPlaybackBookmarkFileKey(track);
  const bookmarks = findBookmarks(key).filter(({ id }) => id !== bookmarkId);
  playbackBookmarksStore.update((state) => ({
    buckets: bookmarks.length > 0
      ? state.buckets.map((bucket) => bucket.key === key ? { ...bucket, bookmarks } : bucket)
      : state.buckets.filter((bucket) => bucket.key !== key)
  }));
  return bookmarks;
}
