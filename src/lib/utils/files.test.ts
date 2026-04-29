import { describe, expect, it } from 'vitest';

import {
  inferArtistTitleFromFileName,
  inferExtension,
  inferKind,
  mergeInferredArtistTitle,
  stripFileExtension
} from './files';

describe('file helpers', () => {
  it('infers supported file extensions and playback kinds', () => {
    expect(inferExtension('Track.FLAC')).toBe('flac');
    expect(inferExtension('README')).toBe('');
    expect(inferKind('flac')).toBe('stream');
    expect(inferKind('xm')).toBe('module');
    expect(inferKind('txt')).toBeNull();
  });

  it('strips only the final filename extension', () => {
    expect(stripFileExtension('Artist - Song.live.FLAC')).toBe('Artist - Song.live');
    expect(stripFileExtension('module')).toBe('module');
  });

  it('infers artist and title from the configured filename pattern', () => {
    expect(inferArtistTitleFromFileName('Skee Mask - Flyby Vfr.flac')).toEqual({
      artist: 'Skee Mask',
      title: 'Flyby Vfr'
    });
    expect(inferArtistTitleFromFileName('No separator.flac')).toBeNull();
  });

  it('merges inferred artist/title without overwriting existing metadata', () => {
    expect(mergeInferredArtistTitle({}, 'Artist - Title.opus')).toEqual({
      artist: 'Artist',
      title: 'Title'
    });
    expect(mergeInferredArtistTitle({ title: 'Tagged Title' }, 'Artist - Filename Title.opus')).toEqual({
      artist: 'Artist',
      title: 'Tagged Title'
    });
    expect(mergeInferredArtistTitle({}, 'Artist - Title.opus', false)).toEqual({});
  });
});
