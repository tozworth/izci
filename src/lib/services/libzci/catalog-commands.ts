import { toSvelteRating } from './catalog-snapshot';

/**
 * Svelte-side builder/validation boundary for core catalog user facts.
 *
 * The Rust owner (`libzci::catalog::CatalogCommand`, `Profile.catalog_request`)
 * remains the only catalog authority. This module pins the JSON contract for
 * the commands the Svelte UI can issue without a probe worker (favorite,
 * rate, bookmark, remove-bookmark, remove media) and maps the Svelte rating
 * domain to the core half-star steps. Scan/probe-owned commands (`add`,
 * `root`, `remove_root`, `finish_scan`) are typed for wire completeness but
 * have no builders here; they belong to the future probe/scan slice.
 *
 * JSON shapes mirror `libzci/consumers/crude-pwa/src/catalog-types.ts` and
 * the Rust `#[serde(tag = "kind", rename_all = "snake_case")]` envelope.
 */

export const CATALOG_MAX_ID = 9_007_199_254_740_991;
export const CATALOG_MAX_BOOKMARK_LABEL = 4_096;
export const CATALOG_MAX_REMOVE_BATCH = 10_000;

export type CoreCatalogCommand =
  | { kind: 'favorite'; media: number; subsong: number | null; favorite: boolean }
  | { kind: 'rate'; media: number; subsong: number | null; rating: number }
  | {
      kind: 'bookmark';
      media: number;
      subsong: number | null;
      position_seconds: number;
      label: string;
    }
  | { kind: 'remove_bookmark'; id: number }
  | { kind: 'remove'; media: number[] }
  // Probe/scan-owned commands: wire types only, no Svelte builders yet.
  | { kind: 'add'; media: unknown[] }
  | { kind: 'root'; root: unknown }
  | { kind: 'remove_root'; root: number }
  | { kind: 'finish_scan'; token: string };

function isValidCatalogId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= CATALOG_MAX_ID
  );
}

function isValidSubsong(value: unknown): value is number | null {
  if (value === null || value === undefined) return true;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 4_294_967_295;
}

function normalizeSubsong(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!isValidSubsong(value)) throw new Error(`Invalid subsong: ${String(value)}`);
  return value;
}

/**
 * Map the Svelte rating domain (0.5..5, undefined clears) to core half-star
 * steps (0..10, 0 clears). Mirrors `normalizeTrackRating` plus the core
 * `rating BETWEEN 0 AND 10` check.
 */
export function toCoreRating(value: number | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  const stepped = Math.round(value * 2) / 2;
  const clamped = Math.min(5, Math.max(0.5, stepped));
  return Math.round(clamped * 2);
}

/** Round-trip helper for tests and future UI binding (core -> Svelte). */
export function fromCoreRating(value: number): number | undefined {
  return toSvelteRating(value);
}

function validateMedia(value: number): void {
  if (!isValidCatalogId(value)) throw new Error(`Invalid catalog media id: ${String(value)}`);
}

function validatePositionSeconds(value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid position_seconds: ${String(value)}`);
  }
}

function validateBookmarkLabel(label: string): void {
  if (typeof label !== 'string' || label.length > CATALOG_MAX_BOOKMARK_LABEL || label.includes('\0')) {
    throw new Error('Invalid bookmark label: expected 0..4096 chars without NUL');
  }
}

export function buildFavoriteCommand(
  media: number,
  subsong: number | null | undefined,
  favorite: boolean
): CoreCatalogCommand {
  validateMedia(media);
  return { kind: 'favorite', media, subsong: normalizeSubsong(subsong), favorite: favorite === true };
}

export function buildRateCommand(
  media: number,
  subsong: number | null | undefined,
  rating: number | undefined
): CoreCatalogCommand {
  validateMedia(media);
  const coreRating = toCoreRating(rating);
  if (!Number.isSafeInteger(coreRating) || coreRating < 0 || coreRating > 10) {
    throw new Error(`Invalid rating: ${String(rating)}`);
  }
  return { kind: 'rate', media, subsong: normalizeSubsong(subsong), rating: coreRating };
}

export function buildBookmarkCommand(
  media: number,
  subsong: number | null | undefined,
  positionSeconds: number,
  label: string
): CoreCatalogCommand {
  validateMedia(media);
  validatePositionSeconds(positionSeconds);
  validateBookmarkLabel(label);
  return {
    kind: 'bookmark',
    media,
    subsong: normalizeSubsong(subsong),
    position_seconds: positionSeconds,
    label
  };
}

export function buildRemoveBookmarkCommand(id: number): CoreCatalogCommand {
  if (!isValidCatalogId(id)) throw new Error(`Invalid bookmark id: ${String(id)}`);
  return { kind: 'remove_bookmark', id };
}

export function buildRemoveMediaCommand(mediaIds: number[]): CoreCatalogCommand {
  if (mediaIds.length === 0 || mediaIds.length > CATALOG_MAX_REMOVE_BATCH) {
    throw new Error(`Invalid remove batch: expected 1..${CATALOG_MAX_REMOVE_BATCH} media ids`);
  }
  for (const id of mediaIds) validateMedia(id);
  return { kind: 'remove', media: [...mediaIds] };
}

/** Serialize a catalog command for the owner-worker `catalog` channel. */
export function serializeCatalogCommand(command: CoreCatalogCommand): string {
  return JSON.stringify(command);
}
