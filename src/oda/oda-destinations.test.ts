import { describe, expect, it } from 'vitest';
import type { TrackItem, TrackKind } from '$lib/types';
import {
  buildOdaHomeSections,
  resolveNowPlayingRoute,
  resolveOdaMediaCounts,
  selectOdaImages,
  selectOdaMusic,
  selectOdaRecents,
  selectOdaVideos
} from './oda-destinations';

let sequence = 0;

function track(kind: TrackKind, metadata: TrackItem['metadata'] = {}, path = `/music/file-${sequence}.ext`): TrackItem {
  sequence += 1;
  return {
    id: `track-${sequence}`,
    name: `file-${sequence}.ext`,
    extension: kind === 'module' ? 'mod' : kind === 'video' ? 'mp4' : kind === 'image' ? 'png' : 'flac',
    kind,
    size: 1,
    lastModified: 1,
    path,
    metadata
  };
}

const LIBRARY: TrackItem[] = [
  track('stream', { artist: 'Aphex Twin', album: 'Selected Ambient Works', genre: 'Ambient', year: '1992' }, '/music/aphex/1.flac'),
  track('module', { artist: 'Aphex Twin', album: 'Selected Ambient Works', genre: 'Ambient; Electronic', year: '1992' }, '/music/aphex/2.mod'),
  track('stream', { artist: 'Boards of Canada', album: 'Music Has the Right to Children', genre: 'Electronic', year: '1998' }, '/music/boc/1.flac'),
  track('video', { width: 1920, height: 1080 }, '/video/clip.mp4'),
  track('image', { width: 800, height: 600 }, '/images/cover.png')
];

describe('Oda media selectors', () => {
  it('filters music, video and image kinds', () => {
    expect(selectOdaMusic(LIBRARY)).toHaveLength(3);
    expect(selectOdaVideos(LIBRARY)).toHaveLength(1);
    expect(selectOdaImages(LIBRARY)).toHaveLength(1);
  });

  it('derives recents from lastPlayed descending and drops untimestamped items', () => {
    const items = [
      track('stream', { lastPlayed: 100 }),
      track('stream', {}),
      track('stream', { lastPlayed: 300 }),
      track('stream', { lastPlayed: 200 })
    ];
    expect(selectOdaRecents(items).map((item) => item.metadata?.lastPlayed)).toEqual([300, 200, 100]);
  });
});

describe('resolveOdaMediaCounts', () => {
  it('counts music-scoped groups only', () => {
    const counts = resolveOdaMediaCounts(LIBRARY);
    expect(counts.music).toBe(3);
    expect(counts.videos).toBe(1);
    expect(counts.images).toBe(1);
    expect(counts.songs).toBe(3);
    expect(counts.artists).toBe(2);
    expect(counts.albums).toBe(2);
    expect(counts.genres).toBe(2);
    expect(counts.years).toBe(2);
    expect(counts.formats).toBe(2);
    expect(counts.folders).toBe(3);
    expect(counts.recents).toBe(0);
  });
});

describe('buildOdaHomeSections', () => {
  it('builds the settled header order with live counts', () => {
    const sections = buildOdaHomeSections(resolveOdaMediaCounts(LIBRARY));
    expect(sections.map((section) => section.id)).toEqual([
      'images',
      'videos',
      'music',
      'now-playing',
      'recents',
      'options'
    ]);

    const images = sections[0].cards[0];
    expect(images.count).toBe(1);
    expect(images.empty).toBe(false);

    const musicCards = sections[2].cards;
    expect(musicCards.map((card) => card.id)).toEqual([
      'browse-music',
      'artists',
      'albums',
      'songs',
      'genres',
      'years',
      'formats',
      'folders'
    ]);
    expect(musicCards.find((card) => card.id === 'artists')?.route)
      .toEqual({ name: 'browse', medium: 'music', view: 'artists' });

    const options = sections[5].cards;
    expect(options.map((card) => card.id)).toEqual(['all-options', 'exit-oda']);
    expect(options.find((card) => card.id === 'exit-oda')?.command).toBe('exit-oda');
    expect(options.find((card) => card.id === 'all-options')?.route)
      .toEqual({ name: 'options', view: 'oda' });
  });

  it('keeps empty destinations focusable with an empty marker', () => {
    const sections = buildOdaHomeSections(resolveOdaMediaCounts([]));
    const images = sections[0].cards[0];
    expect(images.empty).toBe(true);
    expect(images.route).toEqual({ name: 'browse', medium: 'image', view: 'songs' });
  });
});

describe('resolveNowPlayingRoute', () => {
  it('routes by current item kind', () => {
    expect(resolveNowPlayingRoute(null)).toEqual({ name: 'now-playing' });
    expect(resolveNowPlayingRoute(track('stream'))).toEqual({ name: 'now-playing' });
    expect(resolveNowPlayingRoute(track('module'))).toEqual({ name: 'now-playing' });
    expect(resolveNowPlayingRoute(track('video'))).toEqual({ name: 'video-theater' });
    expect(resolveNowPlayingRoute(track('image'))).toEqual({ name: 'image-theater' });
  });
});
