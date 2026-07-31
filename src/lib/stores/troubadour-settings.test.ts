import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TROUBADOUR_SETTINGS,
  TROUBADOUR_METADATA_FIELDS,
  normalizeTroubadourInteger,
  normalizeTroubadourMetadataFields,
  normalizeTroubadourSettings
} from './troubadour-settings';

describe('normalizeTroubadourSettings', () => {
  it('returns an independent current-version default shape for missing state', () => {
    const settings = normalizeTroubadourSettings(undefined);

    expect(settings).toEqual(DEFAULT_TROUBADOUR_SETTINGS);
    expect(settings.paneLayout).not.toBe(DEFAULT_TROUBADOUR_SETTINGS.paneLayout);
    expect(settings.visibleMetadataFields).not.toBe(DEFAULT_TROUBADOUR_SETTINGS.visibleMetadataFields);
  });

  it('keeps supported policies and clamps bounded job controls', () => {
    const settings = normalizeTroubadourSettings({
      initialLoad: 'nothing',
      metadataReadConcurrency: 99,
      writeConcurrency: 0,
      folderScanDepth: '7',
      collisionPolicy: 'counter',
      backupPolicy: 'sibling',
      paneLayout: { rawFilesPercent: 5, inspectorPercent: 90, artworkPercent: 32 }
    });

    expect(settings.initialLoad).toBe('nothing');
    expect(settings.metadataReadConcurrency).toBe(12);
    expect(settings.writeConcurrency).toBe(1);
    expect(settings.folderScanDepth).toBe(7);
    expect(settings.collisionPolicy).toBe('counter');
    expect(settings.backupPolicy).toBe('sibling');
    expect(settings.paneLayout).toEqual({ rawFilesPercent: 20, inspectorPercent: 70, artworkPercent: 32 });
  });

  it('keeps Loudness as a restorable Troubadour tab', () => {
    expect(normalizeTroubadourSettings({ lastActiveTab: 'loudness' }).lastActiveTab).toBe('loudness');
  });

  it('keeps Spectrogram as a restorable Troubadour tab', () => {
    expect(normalizeTroubadourSettings({ lastActiveTab: 'spectrogram' }).lastActiveTab).toBe('spectrogram');
  });

  it('rejects invalid enums instead of carrying unreleased settings shapes forward', () => {
    const settings = normalizeTroubadourSettings({
      initialLoad: 'playlist',
      externalChangeBehavior: 'overwrite',
      copyVerification: 'none'
    });

    expect(settings.initialLoad).toBe(DEFAULT_TROUBADOUR_SETTINGS.initialLoad);
    expect(settings.externalChangeBehavior).toBe('stop');
    expect(settings.copyVerification).toBe(DEFAULT_TROUBADOUR_SETTINGS.copyVerification);
  });
});

describe('Troubadour field normalization', () => {
  it('preserves supported field order while removing duplicates and unknown values', () => {
    expect(normalizeTroubadourMetadataFields(['genre', 'title', 'genre', 'secret-frame'])).toEqual(['genre', 'title']);
  });

  it('restores all fields when a persisted field list is unusable', () => {
    expect(normalizeTroubadourMetadataFields([])).toEqual(TROUBADOUR_METADATA_FIELDS);
  });

  it('parses, rounds, and clamps numeric form values', () => {
    expect(normalizeTroubadourInteger('4.6', 2, 1, 8)).toBe(5);
    expect(normalizeTroubadourInteger(-2, 2, 1, 8)).toBe(1);
    expect(normalizeTroubadourInteger('nope', 2, 1, 8)).toBe(2);
  });
});
