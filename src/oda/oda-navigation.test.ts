import { describe, expect, it } from 'vitest';
import {
  clampIndex,
  createBrowserFocusModel,
  createNowPlayingFocusModel,
  findWaterfallFocus,
  initialWaterfallFocus,
  moveGridIndex,
  moveListIndex,
  moveWaterfall,
  waterfallCardFocusId,
  waterfallFocusId,
  waterfallSectionFocusId,
  type OdaWaterfallSection
} from './oda-navigation';
import { resolveOdaNowPlayingRemovalTargetId } from './oda-now-playing';

describe('createBrowserFocusModel', () => {
  const FILTERS = ['browse-filter:music:songs', 'browse-filter:music:albums'];
  const CONTENT = ['item:a', 'item:b', 'item:c', 'item:d', 'item:e'];

  it('moves vertically through filters and crosses right into content', () => {
    const model = createBrowserFocusModel(FILTERS, FILTERS[0], CONTENT, 4);
    expect(model.resolveMove(FILTERS[0], 'down', false)).toBe(FILTERS[1]);
    expect(model.resolveMove(FILTERS[1], 'right', false)).toBe('item:a');
  });

  it('returns left from a grid edge to the active filter', () => {
    const model = createBrowserFocusModel(FILTERS, FILTERS[1], CONTENT, 4);
    expect(model.resolveMove('item:a', 'left', false)).toBe(FILTERS[1]);
    expect(model.resolveMove('item:e', 'left', false)).toBe(FILTERS[1]);
    expect(model.resolveMove('item:c', 'left', false)).toBe('item:b');
  });

  it('uses single-column movement for list content', () => {
    const model = createBrowserFocusModel(FILTERS, FILTERS[0], CONTENT, 1);
    expect(model.resolveMove('item:a', 'down', false)).toBe('item:b');
    expect(model.resolveMove('item:b', 'left', false)).toBe(FILTERS[0]);
  });
});

const SECTIONS: OdaWaterfallSection[] = [
  { id: 'images', cardIds: ['browse-images'] },
  { id: 'videos', cardIds: ['browse-videos'] },
  { id: 'music', cardIds: ['browse-music', 'artists', 'albums', 'songs'] },
  { id: 'now-playing', cardIds: ['now-playing-card', 'queue'] },
  { id: 'recents', cardIds: ['browse-recents'] },
  { id: 'options', cardIds: ['all-options', 'exit-oda'] }
];

describe('createNowPlayingFocusModel', () => {
  const TRANSPORT = [
    ['np:progress'],
    ['np:shuffle', 'np:previous', 'np:play-pause', 'np:next', 'np:repeat', 'np:volume']
  ];
  const QUEUE = ['item:a', 'item:b'];
  const ACTIONS = [
    ['np:queue-action:move-up:a', 'np:queue-action:move-down:a', 'np:queue-action:remove:a'],
    ['np:queue-action:move-up:b', 'np:queue-action:move-down:b', 'np:queue-action:remove:b']
  ];

  it('resolves an empty focus to the first transport control', () => {
    const model = createNowPlayingFocusModel(TRANSPORT, QUEUE);
    expect(model.resolveMove(null, 'down', false)).toBe('np:progress');
    expect(model.resolveMove(null, 'left', false)).toBe('np:progress');
  });

  it('moves left/right within transport while the timeline keeps horizontal focus', () => {
    const model = createNowPlayingFocusModel(TRANSPORT, QUEUE);
    expect(model.resolveMove('np:progress', 'left', false)).toBe('np:progress');
    expect(model.resolveMove('np:progress', 'right', false)).toBe('np:progress');
    expect(model.resolveMove('np:previous', 'right', false)).toBe('np:play-pause');
    expect(model.resolveMove('np:play-pause', 'left', false)).toBe('np:previous');
    expect(model.resolveMove('np:shuffle', 'left', true)).toBe('np:volume');
    expect(model.resolveMove('np:next', 'right', false)).toBe('np:repeat');
    expect(model.resolveMove('np:volume', 'right', false)).toBe('item:a');
  });

  it('crosses into the queue and back to the last transport control', () => {
    const model = createNowPlayingFocusModel(TRANSPORT, QUEUE);
    expect(model.resolveMove('np:progress', 'down', false)).toBe('np:play-pause');
    expect(model.resolveMove('np:play-pause', 'down', false)).toBe('item:a');
    expect(model.resolveMove('item:a', 'down', false)).toBe('item:b');
    expect(model.resolveMove('item:b', 'down', false)).toBe('item:b');
    expect(model.resolveMove('item:a', 'up', false)).toBe('np:volume');
    expect(model.resolveMove('item:b', 'up', false)).toBe('item:a');
  });

  it('falls back for an unknown focus without a queue', () => {
    const model = createNowPlayingFocusModel(TRANSPORT, []);
    expect(model.resolveMove('gone', 'down', false)).toBe('np:progress');
    expect(model.resolveMove('np:volume', 'down', false)).toBe('np:volume');
  });

  it('opens queue actions to the right and returns left to the row', () => {
    const model = createNowPlayingFocusModel(TRANSPORT, QUEUE, ACTIONS);
    expect(model.resolveMove('item:a', 'right', false)).toBe('np:queue-action:move-up:a');
    expect(model.resolveMove('np:queue-action:move-up:a', 'right', false))
      .toBe('np:queue-action:move-down:a');
    expect(model.resolveMove('np:queue-action:move-up:a', 'left', false)).toBe('item:a');
    expect(model.resolveMove('np:queue-action:remove:a', 'down', false))
      .toBe('np:queue-action:remove:b');
  });
});

describe('resolveOdaNowPlayingRemovalTargetId', () => {
  it('keeps queue focus on the next survivor, then the previous survivor', () => {
    expect(resolveOdaNowPlayingRemovalTargetId(['a', 'b', 'c'], 'b')).toBe('c');
    expect(resolveOdaNowPlayingRemovalTargetId(['a', 'b', 'c'], 'c')).toBe('b');
    expect(resolveOdaNowPlayingRemovalTargetId(['a'], 'a')).toBeNull();
  });
});

describe('clampIndex', () => {
  it('clamps into range and collapses empty lists', () => {
    expect(clampIndex(-2, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2, 0)).toBe(0);
  });
});

describe('moveListIndex', () => {
  it('moves and clamps without wrap', () => {
    expect(moveListIndex(0, 4, 'down', false)).toBe(1);
    expect(moveListIndex(0, 4, 'up', false)).toBe(0);
    expect(moveListIndex(3, 4, 'down', false)).toBe(3);
  });

  it('wraps when enabled', () => {
    expect(moveListIndex(3, 4, 'down', true)).toBe(0);
    expect(moveListIndex(0, 4, 'up', true)).toBe(3);
  });
});

describe('moveGridIndex', () => {
  it('moves by cell horizontally and by row vertically', () => {
    expect(moveGridIndex(1, 3, 9, 'right', false)).toBe(2);
    expect(moveGridIndex(1, 3, 9, 'down', false)).toBe(4);
    expect(moveGridIndex(4, 3, 9, 'up', false)).toBe(1);
  });

  it('clamps row movement to the nearest column without wrap', () => {
    expect(moveGridIndex(1, 3, 9, 'up', false)).toBe(1);
    expect(moveGridIndex(7, 3, 9, 'down', false)).toBe(7);
    expect(moveGridIndex(7, 3, 8, 'down', false)).toBe(7);
    expect(moveGridIndex(4, 3, 8, 'down', false)).toBe(7);
  });

  it('wraps whole rows when enabled', () => {
    expect(moveGridIndex(1, 3, 9, 'up', true)).toBe(7);
    expect(moveGridIndex(7, 3, 9, 'down', true)).toBe(1);
  });
});

describe('waterfall navigation', () => {
  it('resolves focus IDs for headers and cards', () => {
    expect(waterfallFocusId({ sectionIndex: 0, cardIndex: 0, onCards: false }, SECTIONS))
      .toBe(waterfallSectionFocusId('images'));
    expect(waterfallFocusId({ sectionIndex: 2, cardIndex: 1, onCards: true }, SECTIONS))
      .toBe(waterfallCardFocusId('music', 'artists'));
  });

  it('lands on the first card with Up/Down', () => {
    const header = { sectionIndex: 0, cardIndex: 0, onCards: false };
    expect(moveWaterfall(header, SECTIONS, 'down', false))
      .toEqual({ sectionIndex: 1, cardIndex: 0, onCards: true });
    expect(moveWaterfall(header, SECTIONS, 'up', false))
      .toEqual({ sectionIndex: 0, cardIndex: 0, onCards: true });
  });

  it('wraps sections only when enabled', () => {
    const last = { sectionIndex: SECTIONS.length - 1, cardIndex: 0, onCards: false };
    expect(moveWaterfall(last, SECTIONS, 'down', false).sectionIndex).toBe(SECTIONS.length - 1);
    expect(moveWaterfall(last, SECTIONS, 'down', true).sectionIndex).toBe(0);
    expect(moveWaterfall({ sectionIndex: 0, cardIndex: 0, onCards: true }, SECTIONS, 'up', true).sectionIndex)
      .toBe(SECTIONS.length - 1);
  });

  it('starts on the Now Playing card, falling back to the first section', () => {
    expect(initialWaterfallFocus(SECTIONS))
      .toEqual({ sectionIndex: 3, cardIndex: 0, onCards: true });
    expect(initialWaterfallFocus([{ id: 'images', cardIds: ['browse-images'] }]))
      .toEqual({ sectionIndex: 0, cardIndex: 0, onCards: true });
  });

  it('Right enters cards and Left/Right move between them', () => {
    const header = { sectionIndex: 0, cardIndex: 0, onCards: false };
    const entered = moveWaterfall(header, SECTIONS, 'right', false);
    expect(entered).toEqual({ sectionIndex: 0, cardIndex: 0, onCards: true });
    expect(moveWaterfall(entered, SECTIONS, 'left', false)).toEqual(entered);

    const music = { sectionIndex: 2, cardIndex: 0, onCards: true };
    expect(moveWaterfall(music, SECTIONS, 'right', false).cardIndex).toBe(1);
    expect(moveWaterfall({ sectionIndex: 2, cardIndex: 3, onCards: true }, SECTIONS, 'right', false).cardIndex).toBe(3);
    expect(moveWaterfall({ sectionIndex: 2, cardIndex: 3, onCards: true }, SECTIONS, 'right', true).cardIndex).toBe(0);
  });

  it('preserves card column across headers while on cards', () => {
    const music = { sectionIndex: 2, cardIndex: 3, onCards: true };
    const down = moveWaterfall(music, SECTIONS, 'down', false);
    expect(down).toEqual({ sectionIndex: 3, cardIndex: 1, onCards: true });
    const furtherDown = moveWaterfall(down, SECTIONS, 'down', false);
    expect(furtherDown).toEqual({ sectionIndex: 4, cardIndex: 0, onCards: true });
  });

  it('returns to headers for empty sections', () => {
    const sections: OdaWaterfallSection[] = [
      { id: 'empty', cardIds: [] },
      { id: 'full', cardIds: ['a', 'b'] }
    ];
    const focus = { sectionIndex: 1, cardIndex: 1, onCards: true };
    expect(moveWaterfall(focus, sections, 'up', false)).toEqual({
      sectionIndex: 0,
      cardIndex: 0,
      onCards: false
    });
  });

  it('re-resolves stale focus IDs to null', () => {
    expect(findWaterfallFocus(waterfallSectionFocusId('music'), SECTIONS)).toEqual({
      sectionIndex: 2,
      cardIndex: 0,
      onCards: false
    });
    expect(findWaterfallFocus(waterfallCardFocusId('music', 'albums'), SECTIONS)).toEqual({
      sectionIndex: 2,
      cardIndex: 2,
      onCards: true
    });
    expect(findWaterfallFocus(waterfallCardFocusId('music', 'gone'), SECTIONS)).toBeNull();
    expect(findWaterfallFocus(null, SECTIONS)).toBeNull();
  });
});
