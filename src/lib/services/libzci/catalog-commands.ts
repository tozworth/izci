import { toSvelteRating } from './catalog-snapshot';
import { buildScanSettings, validateRootInput, type CoreRootInput } from './scan-roots';
import type { CoreSourceReference } from './queue-snapshot';

/**
 * Svelte-side builder/validation boundary for core catalog commands.
 *
 * The Rust owner (`libzci::catalog::CatalogCommand`, `Profile.catalog_request`)
 * remains the only catalog authority. This module pins the JSON contract for
 * user facts (favorite, rate, bookmark, remove-bookmark, remove media) plus
 * managed-root lifecycle (`root`, `remove_root`) built from the scan-roots
 * boundary. Media `add` and scan `finish_scan` stay probe/worker-owned with
 * wire types only.
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
  | { kind: 'root'; root: CoreRootInput }
  | { kind: 'remove_root'; root: number }
  // Probe/worker-owned commands: wire types only, no Svelte builders yet.
  | { kind: 'add'; media: unknown[] }
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

export interface SvelteRootInput {
  source: CoreSourceReference;
  libraryMode: 'manual' | 'launch' | null;
  verifyAddedFiles: boolean;
}

/**
 * Build a managed-root command from a Svelte folder. The source must be a
 * reusable platform reference (`browser_handle` or `native_path`); Svelte
 * `launch` folders opt into startup scans.
 */
export function buildAddRootCommand(input: SvelteRootInput): CoreCatalogCommand {
  const root: CoreRootInput = {
    source: input.source,
    settings: buildScanSettings({
      recursive: true,
      scan_on_launch: input.libraryMode === 'launch',
      verify_unknown: input.verifyAddedFiles === true,
      probe_concurrency: 2
    })
  };
  validateRootInput(root);
  return { kind: 'root', root };
}

export function buildRemoveRootCommand(rootId: number): CoreCatalogCommand {
  if (!isValidCatalogId(rootId)) throw new Error(`Invalid managed root id: ${String(rootId)}`);
  return { kind: 'remove_root', root: rootId };
}

/** Serialize a catalog command for the owner-worker `catalog` channel. */
export function serializeCatalogCommand(command: CoreCatalogCommand): string {
  return JSON.stringify(command);
}
