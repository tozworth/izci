import { describe, expect, it } from 'vitest';
import type { TrackItem } from '$lib/types';
import {
  fitVisualThumbnailSize,
  getVisualThumbnailRenditionKey,
  getVisualThumbnailSourceFingerprint,
  selectVideoThumbnailTime
} from './visual-thumbnail-cache';

function item(overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'visual',
    name: 'Clip.mp4',
    extension: 'mp4',
    kind: 'video',
    size: 1234,
    lastModified: 5678,
    ...overrides
  };
}

describe('visual thumbnail cache helpers', () => {
  it('fits thumbnails within the requested edge without upscaling', () => {
    expect(fitVisualThumbnailSize(1920, 1080, 384)).toEqual({ width: 384, height: 216 });
    expect(fitVisualThumbnailSize(120, 80, 384)).toEqual({ width: 120, height: 80 });
    expect(fitVisualThumbnailSize(0, 80, 384)).toEqual({ width: 0, height: 0 });
  });

  it('invalidates a source when its file indicators or kind change', () => {
    const original = getVisualThumbnailSourceFingerprint(item());
    expect(getVisualThumbnailSourceFingerprint(item({ size: 1235 }))).not.toBe(original);
    expect(getVisualThumbnailSourceFingerprint(item({ lastModified: 5679 }))).not.toBe(original);
    expect(getVisualThumbnailSourceFingerprint(item({ kind: 'image', extension: 'png' }))).not.toBe(original);
  });

  it('keeps rendition size and fingerprint in the cache key', () => {
    expect(getVisualThumbnailRenditionKey('visual', 'a', 384))
      .not.toBe(getVisualThumbnailRenditionKey('visual', 'a', 640));
    expect(getVisualThumbnailRenditionKey('visual', 'a', 384))
      .not.toBe(getVisualThumbnailRenditionKey('visual', 'b', 384));
  });

  it('chooses an early representative frame with safe bounds', () => {
    expect(selectVideoThumbnailTime(100)).toBe(5);
    expect(selectVideoThumbnailTime(20)).toBe(2);
    expect(selectVideoThumbnailTime(0.08)).toBeCloseTo(0.03);
    expect(selectVideoThumbnailTime(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
