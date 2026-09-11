import { describe, expect, it } from 'vitest';
import type { TrackItem } from '$lib/types';
import { ODA_HOME_ROUTE } from '$lib/services/oda-session';
import {
  resolveOdaRouteDefaultFocusId,
  resolveOdaRouteFocusIds,
  resolveOdaRouteFocusModel,
  resolveOdaRouteTrackItems,
  type OdaRouteFocusContext
} from './oda-route-focus';

let sequence = 0;

function track(id: string, metadata: TrackItem['metadata'] = {}, kind: TrackItem['kind'] = 'stream'): TrackItem {
  sequence += 1;
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind,
    size: 1,
    lastModified: 1,
    path: `/music/${id}.flac`,
    metadata
  };
}

const MUSIC = [
  track('m1', { artist: 'Aphex Twin', album: 'SAW' }),
  track('m2', { artist: 'Boards of Canada', album: 'MHTRTC' })
];
const VIDEOS = [track('v1', {}, 'video')];
const IMAGES = [track('i1', {}, 'image')];
const RECENTS = [track('r1', { lastPlayed: 5 })];
const QUEUE = [track('q1'), track('q2')];

const CONTEXT: OdaRouteFocusContext = {
  musicItems: MUSIC,
  videoItems: VIDEOS,
  imageItems: IMAGES,
  recentsItems: RECENTS,
  queueItems: QUEUE,
  optionCategoryIds: ['option:oda', 'option:appearance'],
  homeWaterfallSections: [
    { id: 'images', cardIds: ['browse-images'] },
    { id: 'music', cardIds: ['browse-music', 'artists'] }
  ]
};

describe('resolveOdaRouteTrackItems', () => {
  it('selects the right effective collection per route', () => {
    expect(resolveOdaRouteTrackItems({ name: 'recents' }, CONTEXT)).toBe(RECENTS);
    expect(resolveOdaRouteTrackItems({ name: 'queue' }, CONTEXT)).toBe(QUEUE);
    expect(resolveOdaRouteTrackItems({ name: 'browse', medium: 'video', view: 'tracks' }, CONTEXT)).toBe(VIDEOS);
    expect(resolveOdaRouteTrackItems({ name: 'browse', medium: 'image', view: 'tracks' }, CONTEXT)).toBe(IMAGES);
    expect(resolveOdaRouteTrackItems({ name: 'browse', medium: 'music', view: 'songs' }, CONTEXT)).toBe(MUSIC);
  });

  it('returns group items when a browse group is active', () => {
    const [group] = resolveOdaRouteFocusIds(
      { name: 'browse', medium: 'music', view: 'artists' },
      CONTEXT
    ).map((focusId) => focusId.slice('group:'.length));
    expect(group).toBeTruthy();
    expect(
      resolveOdaRouteTrackItems(
        { name: 'browse', medium: 'music', view: 'artists', groupKey: group },
        CONTEXT
      )
    ).toHaveLength(1);
  });
});

describe('resolveOdaRouteFocusIds', () => {
  it('uses group focus IDs for a grouped browse list', () => {
    const ids = resolveOdaRouteFocusIds({ name: 'browse', medium: 'music', view: 'artists' }, CONTEXT);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith('group:'))).toBe(true);
  });

  it('uses track focus IDs for flat and group levels', () => {
    const flat = resolveOdaRouteFocusIds({ name: 'browse', medium: 'music', view: 'songs' }, CONTEXT);
    expect(flat).toEqual(['item:m1', 'item:m2']);
  });

  it('combines transport and queue IDs for Now Playing', () => {
    const ids = resolveOdaRouteFocusIds({ name: 'now-playing' }, CONTEXT);
    expect(ids[0]).toBe('np:previous');
    expect(ids).toContain('np:play-pause');
    expect(ids.slice(-2)).toEqual(['item:q1', 'item:q2']);
  });

  it('exposes theater controls and options categories', () => {
    expect(resolveOdaRouteFocusIds({ name: 'video-theater' }, CONTEXT)).toContain('th:play-pause');
    expect(resolveOdaRouteFocusIds({ name: 'image-theater' }, CONTEXT)).toContain('th:rotate');
    expect(resolveOdaRouteFocusIds({ name: 'options', view: 'oda' }, CONTEXT))
      .toEqual(['option:exit-oda', 'option:oda', 'option:appearance']);
  });
});

describe('resolveOdaRouteDefaultFocusId', () => {
  it('starts on the first waterfall card on home', () => {
    expect(resolveOdaRouteDefaultFocusId(ODA_HOME_ROUTE, CONTEXT)).toBe('card:images:browse-images');
  });

  it('starts Now Playing on the primary transport control', () => {
    expect(resolveOdaRouteDefaultFocusId({ name: 'now-playing' }, CONTEXT)).toBe('np:play-pause');
  });

  it('starts Options on the first category and theaters on play/pause', () => {
    expect(resolveOdaRouteDefaultFocusId({ name: 'options', view: 'oda' }, CONTEXT)).toBe('option:oda');
    expect(resolveOdaRouteDefaultFocusId({ name: 'video-theater' }, CONTEXT)).toBe('th:play-pause');
  });
});

describe('resolveOdaRouteFocusModel', () => {
  it('moves across the Now Playing transport and queue regions', () => {
    const model = resolveOdaRouteFocusModel({ name: 'now-playing' }, CONTEXT);
    expect(model).not.toBeNull();
    expect(model!.resolveMove(null, 'right', false)).toBe('np:previous');
    expect(model!.resolveMove('np:play-pause', 'down', false)).toBe('item:q1');
    expect(model!.resolveMove('item:q1', 'up', false)).toBe('np:repeat');
  });

  it('clamps a list model without wrap', () => {
    const model = resolveOdaRouteFocusModel({ name: 'browse', medium: 'music', view: 'songs' }, CONTEXT);
    expect(model!.resolveMove('item:m1', 'up', false)).toBe('item:m1');
    expect(model!.resolveMove('item:m1', 'down', false)).toBe('item:m2');
    expect(model!.resolveMove('item:m2', 'down', false)).toBe('item:m2');
  });
});
