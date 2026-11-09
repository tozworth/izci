import { describe, expect, it } from 'vitest';
import {
  buildScanSettings,
  defaultScanSettings,
  svelteFolderToScanSettings,
  validateManagedRoot,
  validateRootInput,
  validateScanPlan,
  validateScanSummary,
  type CoreManagedRoot,
  type CoreScanPlan
} from './scan-roots';

const source = { key: 'cap/root', kind: 'browser_handle' as const, locator: 'cap/root', display_path: 'Music' };

function root(): CoreManagedRoot {
  return { id: 3, revision: 5, config: { source, settings: defaultScanSettings() } };
}

function plan(): CoreScanPlan {
  return {
    token: 'scan-1-abc',
    root: root(),
    max_batch: 256,
    max_entries: 100_000,
    max_bytes: 128 * 1024 * 1024,
    max_total_bytes: 256 * 1024 * 1024
  };
}

describe('core scan roots boundary', () => {
  it('matches Rust scan settings defaults and validation', () => {
    expect(defaultScanSettings()).toEqual({
      recursive: true,
      scan_on_launch: false,
      verify_unknown: true,
      probe_concurrency: 2
    });
    expect(buildScanSettings({ probe_concurrency: 8 }).probe_concurrency).toBe(8);
    expect(() => buildScanSettings({ probe_concurrency: 0 })).toThrow();
    expect(() => buildScanSettings({ probe_concurrency: 9 })).toThrow();
  });

  it('maps Svelte folders to scan settings', () => {
    expect(svelteFolderToScanSettings({ libraryMode: 'launch', verifyAddedFiles: false })).toEqual({
      recursive: true,
      scan_on_launch: true,
      verify_unknown: false,
      probe_concurrency: 2
    });
    expect(svelteFolderToScanSettings({ libraryMode: null, verifyAddedFiles: true }).scan_on_launch).toBe(false);
  });

  it('rejects ephemeral scan roots', () => {
    expect(() => validateRootInput({ source, settings: defaultScanSettings() })).not.toThrow();
    expect(() =>
      validateRootInput({
        source: { ...source, kind: 'ephemeral' },
        settings: defaultScanSettings()
      })
    ).toThrow('reusable platform reference');
    expect(() => validateManagedRoot({ ...root(), id: 0 })).toThrow();
  });

  it('validates scan plans and summaries', () => {
    expect(() => validateScanPlan(plan())).not.toThrow();
    expect(() => validateScanPlan({ ...plan(), token: '' })).toThrow();
    expect(() => validateScanPlan({ ...plan(), max_batch: 257 })).toThrow();
    expect(() => validateScanSummary({ root: 3, entries: 10, added: 4, removed: 1 })).not.toThrow();
    expect(() => validateScanSummary({ root: 0, entries: 0, added: 0, removed: 0 })).toThrow();
  });
});
