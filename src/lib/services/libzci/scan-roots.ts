import { validateSourceReference } from './queue-commands';
import type { CoreSourceReference } from './queue-snapshot';

/**
 * Svelte-side boundary for core managed scan roots.
 *
 * The Rust owner (`Profile.begin_scan/stage_scan/cancel_scan/finish_scan`,
 * `catalog::scans`) remains the only scan authority. This module pins the
 * `ScanSettings`/`RootInput`/`ManagedRoot`/`ScanPlan`/`ScanSummary` shapes and
 * maps Svelte managed folders to core scan settings. Enumeration, probing,
 * staging, and reconciliation belong to the future scan slice; nothing here
 * touches directories, handles, or SQL.
 *
 * Shapes mirror the Rust `catalog::scans` structs and
 * `libzci/consumers/crude-pwa/src/catalog-types.ts`.
 */

export interface CoreScanSettings {
  recursive: boolean;
  scan_on_launch: boolean;
  verify_unknown: boolean;
  probe_concurrency: number;
}

export interface CoreRootInput {
  source: CoreSourceReference;
  settings: CoreScanSettings;
}

export interface CoreManagedRoot {
  id: number;
  revision: number;
  config: CoreRootInput;
}

export interface CoreScanPlan {
  token: string;
  root: CoreManagedRoot;
  max_batch: number;
  max_entries: number;
  max_bytes: number;
  max_total_bytes: number;
}

export interface CoreScanSummary {
  root: number;
  entries: number;
  added: number;
  removed: number;
}

export const SCAN_MAX_ID = 9_007_199_254_740_991;
export const SCAN_MAX_TOKEN = 128;
export const SCAN_MAX_BATCH = 256;
export const SCAN_MAX_ENTRIES = 100_000;
export const SCAN_MAX_BYTES = 128 * 1024 * 1024;
export const SCAN_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

function isValidId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= SCAN_MAX_ID
  );
}

function isValidRevision(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= SCAN_MAX_ID
  );
}

/** Rust `ScanSettings::default()`. */
export function defaultScanSettings(): CoreScanSettings {
  return {
    recursive: true,
    scan_on_launch: false,
    verify_unknown: true,
    probe_concurrency: 2
  };
}

function checkBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid scan settings ${field}: expected boolean`);
  }
}

/** Validate and normalize scan settings (probe concurrency `1..8`). */
export function buildScanSettings(partial: Partial<CoreScanSettings> = {}): CoreScanSettings {
  const settings: CoreScanSettings = { ...defaultScanSettings(), ...partial };
  checkBoolean(settings.recursive, 'recursive');
  checkBoolean(settings.scan_on_launch, 'scan_on_launch');
  checkBoolean(settings.verify_unknown, 'verify_unknown');
  if (
    !Number.isSafeInteger(settings.probe_concurrency) ||
    settings.probe_concurrency < 1 ||
    settings.probe_concurrency > 8
  ) {
    throw new Error(`Invalid probe_concurrency: ${String(settings.probe_concurrency)}`);
  }
  return settings;
}

export interface SvelteFolderScanInput {
  libraryMode: 'manual' | 'launch' | null;
  verifyAddedFiles: boolean;
}

/**
 * Map a Svelte managed folder to core scan settings.
 * `launch` mode opts into startup scans; recursion stays on (shell enforces
 * depth via `folderNestingLimit`); unknown verification follows the Svelte
 * `verifyAddedFiles` tweak; probe concurrency uses the core default until
 * the Svelte UI exposes it.
 */
export function svelteFolderToScanSettings(input: SvelteFolderScanInput): CoreScanSettings {
  return buildScanSettings({
    recursive: true,
    scan_on_launch: input.libraryMode === 'launch',
    verify_unknown: input.verifyAddedFiles === true,
    probe_concurrency: 2
  });
}

/** A managed root needs a reusable platform reference, never `ephemeral`. */
export function validateRootInput(input: CoreRootInput): void {
  validateSourceReference(input.source);
  if (input.source.kind === 'ephemeral') {
    throw new Error('Invalid scan root: managed root requires a reusable platform reference');
  }
  buildScanSettings(input.settings);
}

export function validateManagedRoot(root: CoreManagedRoot): void {
  if (!isValidId(root.id)) throw new Error(`Invalid managed root id: ${String(root.id)}`);
  if (!isValidRevision(root.revision)) {
    throw new Error(`Invalid managed root revision: ${String(root.revision)}`);
  }
  validateRootInput(root.config);
}

function checkToken(token: unknown): asserts token is string {
  if (typeof token !== 'string' || token.length === 0 || token.length > SCAN_MAX_TOKEN || token.includes('\0')) {
    throw new Error('Invalid scan token: expected 1..128 chars without NUL');
  }
}

/** Validate a core-issued scan plan before staging batches against it. */
export function validateScanPlan(plan: CoreScanPlan): void {
  checkToken(plan.token);
  validateManagedRoot(plan.root);
  if (!Number.isSafeInteger(plan.max_batch) || plan.max_batch < 1 || plan.max_batch > SCAN_MAX_BATCH) {
    throw new Error(`Invalid scan max_batch: ${String(plan.max_batch)}`);
  }
  if (!Number.isSafeInteger(plan.max_entries) || plan.max_entries < 1 || plan.max_entries > SCAN_MAX_ENTRIES) {
    throw new Error(`Invalid scan max_entries: ${String(plan.max_entries)}`);
  }
  if (!Number.isSafeInteger(plan.max_bytes) || plan.max_bytes < 1 || plan.max_bytes > SCAN_MAX_BYTES) {
    throw new Error(`Invalid scan max_bytes: ${String(plan.max_bytes)}`);
  }
  if (
    !Number.isSafeInteger(plan.max_total_bytes) ||
    plan.max_total_bytes < 1 ||
    plan.max_total_bytes > SCAN_MAX_TOTAL_BYTES
  ) {
    throw new Error(`Invalid scan max_total_bytes: ${String(plan.max_total_bytes)}`);
  }
}

export function validateScanSummary(summary: CoreScanSummary): void {
  if (!isValidId(summary.root)) throw new Error(`Invalid scan summary root: ${String(summary.root)}`);
  for (const [field, value] of [['entries', summary.entries], ['added', summary.added], ['removed', summary.removed]] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > SCAN_MAX_ENTRIES) {
      throw new Error(`Invalid scan summary ${field}: ${String(value)}`);
    }
  }
}
