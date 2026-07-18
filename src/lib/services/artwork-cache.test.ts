import { describe, expect, it } from 'vitest';
import type { PlaylistItem } from '$lib/types';
import {
  fitArtworkRenditionSize,
  getArtworkRenditionKey,
  getArtworkSourceFingerprint
} from './artwork-cache';

function item(overrides: Partial<PlaylistItem> = {}): PlaylistItem {
  return {
    id: 'track',
    name: 'Track.flac',
    extension: 'flac',
    kind: 'stream',
    size: 1234,
    lastModified: 5678,
    ...overrides
  };
}

describe('artwork cache helpers', () => {
  it('fits renditions within the requested edge without upscaling', () => {
    expect(fitArtworkRenditionSize(1200, 600, 96)).toEqual({ width: 96, height: 48 });
    expect(fitArtworkRenditionSize(48, 24, 96)).toEqual({ width: 48, height: 24 });
    expect(fitArtworkRenditionSize(0, 24, 96)).toEqual({ width: 0, height: 0 });
  });

  it('changes the source fingerprint when file content indicators change', () => {
    const original = getArtworkSourceFingerprint(item());

    expect(getArtworkSourceFingerprint(item({ size: 1235 }))).not.toBe(original);
    expect(getArtworkSourceFingerprint(item({ lastModified: 5679 }))).not.toBe(original);
    expect(getArtworkSourceFingerprint(item({ extension: 'opus' }))).not.toBe(original);
  });

  it('keeps rendition size in the cache key', () => {
    expect(getArtworkRenditionKey('asset', 96)).not.toBe(getArtworkRenditionKey('asset', 512));
  });
});
