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
  songsLayout: 'grid',
  canMutateQueue: true,
  canReorderQueue: true,
  homeWaterfallSections: [
    { id: 'images', cardIds: ['browse-images'] },
    { id: 'music', cardIds: ['browse-music', 'artists'] },
    { id: 'now-playing', cardIds: ['now-playing', 'queue'] }
  ]
};

describe('resolveOdaRouteTrackItems', () => {
  it('selects the right effective collection per route', () => {
    expect(resolveOdaRouteTrackItems({ name: 'recents' }, CONTEXT)).toBe(RECENTS);
    expect(resolveOdaRouteTrackItems({ name: 'queue' }, CONTEXT)).toBe(QUEUE);
    expect(resolveOdaRouteTrackItems({ name: 'browse', medium: 'video', view: 'songs' }, CONTEXT)).toBe(VIDEOS);
    expect(resolveOdaRouteTrackItems({ name: 'browse', medium: 'image', view: 'songs' }, CONTEXT)).toBe(IMAGES);
    expect(resolveOdaRouteTrackItems({ name: 'browse', medium: 'music', view: 'songs' }, CONTEXT)).toBe(MUSIC);
  });

  it('returns group items when a browse group is active', () => {
    const [group] = resolveOdaRouteFocusIds(
      { name: 'browse', medium: 'music', view: 'artists' },
      CONTEXT
    ).filter((focusId) => focusId.startsWith('group:'))
      .map((focusId) => focusId.slice('group:'.length));
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
    expect(ids.filter((id) => id.startsWith('group:')).length).toBeGreaterThan(0);
    expect(ids[0]).toBe('browse-filter:music:songs');
  });

  it('uses track focus IDs for flat and group levels', () => {
    const flat = resolveOdaRouteFocusIds({ name: 'browse', medium: 'music', view: 'songs' }, CONTEXT);
    expect(flat.slice(-2)).toEqual(['item:m1', 'item:m2']);
  });

  it('combines transport and queue IDs for Now Playing', () => {
    const ids = resolveOdaRouteFocusIds({ name: 'now-playing' }, CONTEXT);
    expect(ids[0]).toBe('np:progress');
    expect(ids).toContain('np:play-pause');
    expect(ids).toContain('item:q1');
    expect(ids).toContain('item:q2');
    expect(ids).toContain('np:queue-action:remove:q1');
  });

  it('omits the queue action branch when queue mutation is unavailable', () => {
    const readOnlyContext = {
      ...CONTEXT,
      canMutateQueue: false,
      canReorderQueue: false
    };
    const ids = resolveOdaRouteFocusIds({ name: 'now-playing' }, readOnlyContext);
    const model = resolveOdaRouteFocusModel({ name: 'now-playing' }, readOnlyContext);
    expect(ids.some((id) => id.startsWith('np:queue-action:'))).toBe(false);
    expect(model!.resolveMove('item:q1', 'right', false)).toBe('item:q1');
  });

  it('exposes theater controls and options categories', () => {
    expect(resolveOdaRouteFocusIds({ name: 'video-theater' }, CONTEXT)).toContain('th:play-pause');
    expect(resolveOdaRouteFocusIds({ name: 'image-theater' }, CONTEXT)).toContain('th:rotate');
    expect(resolveOdaRouteFocusIds({ name: 'options', view: 'oda' }, CONTEXT))
      .toEqual(['option:oda', 'option:appearance']);
  });
});

describe('resolveOdaRouteDefaultFocusId', () => {
  it('starts on the Now Playing card on home', () => {
    expect(resolveOdaRouteDefaultFocusId(ODA_HOME_ROUTE, CONTEXT)).toBe('card:now-playing:now-playing');
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
    expect(model!.resolveMove(null, 'right', false)).toBe('np:progress');
    expect(model!.resolveMove('np:progress', 'down', false)).toBe('np:play-pause');
    expect(model!.resolveMove('np:play-pause', 'down', false)).toBe('item:q1');
    expect(model!.resolveMove('np:next', 'right', false)).toBe('np:repeat');
    expect(model!.resolveMove('np:volume', 'right', false)).toBe('item:q1');
    expect(model!.resolveMove('item:q1', 'up', false)).toBe('np:volume');
    expect(model!.resolveMove('item:q1', 'right', false)).toBe('np:queue-action:move-up:q1');
    expect(model!.resolveMove('np:queue-action:move-up:q1', 'left', false)).toBe('item:q1');
  });

  it('clamps a list model without wrap', () => {
    const model = resolveOdaRouteFocusModel(
      { name: 'browse', medium: 'music', view: 'songs' },
      { ...CONTEXT, songsLayout: 'list' }
    );
    expect(model!.resolveMove('item:m1', 'up', false)).toBe('item:m1');
    expect(model!.resolveMove('item:m1', 'down', false)).toBe('item:m2');
    expect(model!.resolveMove('item:m2', 'down', false)).toBe('item:m2');
  });
});
