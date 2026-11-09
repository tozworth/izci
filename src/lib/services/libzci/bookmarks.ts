/**
 * Svelte-side boundary for core media bookmarks.
 *
 * The Rust owner (`Profile.bookmarks`, `CatalogCommand::Bookmark`/
 * `RemoveBookmark`) remains the only bookmark authority. This module pins the
 * core `Bookmark` shape and the Svelte mapping used by the future owner
 * worker when reading `WebProfile.bookmarks(media, subsong)` pages that feed
 * bookmark UI. Svelte's current localStorage bookmarks (string UUIDs per
 * file key) stay shell-side until the bookmark UI moves to core ids.
 *
 * Shapes mirror the Rust `catalog::Bookmark` struct
 * (`ORDER BY position_seconds, id`).
 */

export interface CoreBookmark {
  id: number;
  media: number;
  subsong: number | null;
  position_seconds: number;
  label: string;
}

export interface SvelteBookmarkView {
  id: string;
  name: string;
  time: number;
}

export const BOOKMARKS_MAX_ID = 9_007_199_254_740_991;
export const BOOKMARKS_MAX_LABEL = 4_096;

function isValidId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= BOOKMARKS_MAX_ID
  );
}

function isValidSubsong(value: unknown): value is number | null {
  if (value === null || value === undefined) return true;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 4_294_967_295;
}

/** Validate one core bookmark row before feeding it to Svelte stores. */
export function validateCoreBookmark(bookmark: CoreBookmark): void {
  if (!isValidId(bookmark.id)) throw new Error(`Invalid bookmark id: ${String(bookmark.id)}`);
  if (!isValidId(bookmark.media)) throw new Error(`Invalid bookmark media: ${String(bookmark.media)}`);
  if (!isValidSubsong(bookmark.subsong)) {
    throw new Error(`Invalid bookmark subsong: ${String(bookmark.subsong)}`);
  }
  if (typeof bookmark.position_seconds !== 'number' || !Number.isFinite(bookmark.position_seconds) || bookmark.position_seconds < 0) {
    throw new Error(`Invalid bookmark position_seconds: ${String(bookmark.position_seconds)}`);
  }
  if (typeof bookmark.label !== 'string' || bookmark.label.length > BOOKMARKS_MAX_LABEL || bookmark.label.includes('\0')) {
    throw new Error('Invalid bookmark label: expected 0..4096 chars without NUL');
  }
}

/** Validate a bookmark query target (`WebProfile.bookmarks(media, subsong)`). */
export function validateBookmarkTarget(media: number, subsong: number | null | undefined): void {
  if (!isValidId(media)) throw new Error(`Invalid bookmark media: ${String(media)}`);
  if (!isValidSubsong(subsong)) throw new Error(`Invalid bookmark subsong: ${String(subsong)}`);
}

/** Map a core row to the Svelte bookmark view (core u64 id → string). */
export function toSvelteBookmark(bookmark: CoreBookmark): SvelteBookmarkView {
  validateCoreBookmark(bookmark);
  return {
    id: String(bookmark.id),
    name: bookmark.label.trim() === '' ? 'Bookmark' : bookmark.label,
    time: bookmark.position_seconds
  };
}

/**
 * Map Svelte bookmark fields to core fields for `Bookmark` commands.
 * Empty names become empty labels (core allows them); display fallback to
 * `Bookmark N` stays in the Svelte UI layer.
 */
export function toCoreBookmarkFields(input: { time: number; name: string }): {
  position_seconds: number;
  label: string;
} {
  if (typeof input.time !== 'number' || !Number.isFinite(input.time) || input.time < 0) {
    throw new Error(`Invalid bookmark time: ${String(input.time)}`);
  }
  if (typeof input.name !== 'string' || input.name.length > BOOKMARKS_MAX_LABEL || input.name.includes('\0')) {
    throw new Error('Invalid bookmark name: expected 0..4096 chars without NUL');
  }
  return { position_seconds: input.time, label: input.name };
}

/** Sort core rows in core order (`ORDER BY position_seconds, id`). */
export function sortCoreBookmarks(bookmarks: CoreBookmark[]): CoreBookmark[] {
  return [...bookmarks].sort((left, right) =>
    left.position_seconds === right.position_seconds
      ? left.id - right.id
      : left.position_seconds - right.position_seconds
  );
}
