/**
 * Deterministic Oda focus movement.
 *
 * All movement is index-based rather than element-geometry based so route
 * transitions, waterfall movement, list movement and cross-region movement
 * are testable without a browser. Components own their navigation models and
 * use these helpers to resolve the next logical focus.
 */

import type { OdaDirection } from './oda-input';

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

/**
 * Move within a single vertical list. `wrap` moves past the ends back to the
 * opposite end; otherwise the index is clamped.
 */
export function moveListIndex(
  current: number,
  length: number,
  direction: Extract<OdaDirection, 'up' | 'down'>,
  wrap: boolean
): number {
  if (length <= 0) return 0;
  const step = direction === 'up' ? -1 : 1;
  const next = current + step;
  if (next < 0) return wrap ? length - 1 : 0;
  if (next >= length) return wrap ? 0 : length - 1;
  return next;
}

/**
 * Move within a fixed-column grid. Up/Down move by a row; Left/Right move by
 * one cell. Row movement clamps or wraps by whole rows.
 */
export function moveGridIndex(
  current: number,
  columns: number,
  length: number,
  direction: OdaDirection,
  wrap: boolean
): number {
  if (length <= 0) return 0;
  const safeColumns = Math.max(1, Math.floor(columns));
  const index = clampIndex(current, length);
  const column = index % safeColumns;

  if (direction === 'left' || direction === 'right') {
    const step = direction === 'left' ? -1 : 1;
    const next = index + step;
    if (next < 0) return wrap ? length - 1 : 0;
    if (next >= length) return wrap ? 0 : length - 1;
    return next;
  }

  const step = direction === 'up' ? -safeColumns : safeColumns;
  const next = index + step;
  if (next < 0) {
    if (!wrap) return column;
    const lastRowStart = Math.floor((length - 1) / safeColumns) * safeColumns;
    return clampIndex(lastRowStart + column, length);
  }
  if (next >= length) {
    if (!wrap) return clampIndex(Math.floor((length - 1) / safeColumns) * safeColumns + column, length);
    return clampIndex(column, length);
  }
  return next;
}

export interface OdaWaterfallSection {
  id: string;
  cardIds: string[];
}

export interface OdaWaterfallFocus {
  sectionIndex: number;
  cardIndex: number;
  /**
   * When false, focus is on the section header rather than its cards.
   * Headers are a mouse affordance; keyboard movement lands on cards so
   * Enter activates without a prior Right press.
   */
  onCards: boolean;
}

/**
 * Entry focus for the home waterfall: the Now Playing card, so Oda opens
 * scrolled to Now Playing instead of the top (Images) section. Falls back
 * to the first section when the layout has no Now Playing section.
 */
export function initialWaterfallFocus(sections: readonly OdaWaterfallSection[]): OdaWaterfallFocus {
  const sectionIndex = sections.findIndex((section) => section.id === 'now-playing');
  return { sectionIndex: sectionIndex >= 0 ? sectionIndex : 0, cardIndex: 0, onCards: true };
}

export function waterfallSectionFocusId(sectionId: string): string {
  return `section:${sectionId}`;
}

export function waterfallCardFocusId(sectionId: string, cardId: string): string {
  return `card:${sectionId}:${cardId}`;
}

export function waterfallFocusId(
  focus: OdaWaterfallFocus,
  sections: readonly OdaWaterfallSection[]
): string | null {
  const section = sections[clampIndex(focus.sectionIndex, sections.length)];
  if (!section) return null;
  if (!focus.onCards) return waterfallSectionFocusId(section.id);
  const cardId = section.cardIds[clampIndex(focus.cardIndex, section.cardIds.length)];
  return cardId === undefined ? waterfallSectionFocusId(section.id) : waterfallCardFocusId(section.id, cardId);
}

/**
 * Re-resolve a focus ID back into waterfall coordinates. Returns null when the
 * ID no longer exists (for example a card disappeared after an update).
 */
export function findWaterfallFocus(
  focusId: string | null,
  sections: readonly OdaWaterfallSection[]
): OdaWaterfallFocus | null {
  if (!focusId) return null;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    if (focusId === waterfallSectionFocusId(section.id)) {
      return { sectionIndex, cardIndex: 0, onCards: false };
    }
    const cardIndex = section.cardIds.findIndex(
      (cardId) => focusId === waterfallCardFocusId(section.id, cardId)
    );
    if (cardIndex >= 0) {
      return { sectionIndex, cardIndex, onCards: true };
    }
  }
  return null;
}

function moveSectionIndex(
  current: number,
  length: number,
  direction: Extract<OdaDirection, 'up' | 'down'>,
  wrap: boolean
): number {
  return moveListIndex(current, length, direction, wrap);
}

export function moveWaterfall(
  focus: OdaWaterfallFocus,
  sections: readonly OdaWaterfallSection[],
  direction: OdaDirection,
  wrap: boolean
): OdaWaterfallFocus {
  if (sections.length === 0) return focus;
  const sectionIndex = clampIndex(focus.sectionIndex, sections.length);
  const section = sections[sectionIndex];

  if (direction === 'up' || direction === 'down') {
    const nextSectionIndex = moveSectionIndex(sectionIndex, sections.length, direction, wrap);
    const nextSection = sections[nextSectionIndex];
    if (nextSection.cardIds.length === 0) {
      return { sectionIndex: nextSectionIndex, cardIndex: 0, onCards: false };
    }
    return {
      sectionIndex: nextSectionIndex,
      cardIndex: focus.onCards ? clampIndex(focus.cardIndex, nextSection.cardIds.length) : 0,
      onCards: true
    };
  }

  if (!focus.onCards) {
    if (direction === 'right' && section.cardIds.length > 0) {
      return { sectionIndex, cardIndex: 0, onCards: true };
    }
    return focus;
  }

  const nextCardIndex = moveListIndex(
    focus.cardIndex,
    section.cardIds.length,
    direction === 'left' ? 'up' : 'down',
    wrap
  );
  return { sectionIndex, cardIndex: nextCardIndex, onCards: true };
}

/**
 * A route-owned navigation model. Views build these from their current list,
 * grid, or waterfall and hand them to the Oda focus controller.
 */
export interface OdaFocusModel {
  resolveMove(focusId: string | null, direction: OdaDirection, wrap: boolean): string | null;
}

/** Vertical list model. A null/stale focus resolves to the first entry. */
export function createListFocusModel(ids: readonly string[]): OdaFocusModel {
  return {
    resolveMove: (focusId, direction, wrap) => {
      if (ids.length === 0) return null;
      const current = focusId === null ? -1 : ids.indexOf(focusId);
      if (current < 0) return ids[0];
      const next = moveListIndex(current, ids.length, direction === 'up' ? 'up' : 'down', wrap);
      return ids[next];
    }
  };
}

/** Fixed-column grid model. */
export function createGridFocusModel(ids: readonly string[], columns: number): OdaFocusModel {
  return {
    resolveMove: (focusId, direction, wrap) => {
      if (ids.length === 0) return null;
      const current = focusId === null ? -1 : ids.indexOf(focusId);
      if (current < 0) return ids[0];
      const next = moveGridIndex(current, columns, ids.length, direction, wrap);
      return ids[next];
    }
  };
}

/** Two-region library browser: vertical filters at left, list/grid at right. */
export function createBrowserFocusModel(
  filterIds: readonly string[],
  activeFilterId: string,
  contentIds: readonly string[],
  columns: number
): OdaFocusModel {
  return {
    resolveMove: (focusId, direction, wrap) => {
      const fallback = filterIds.includes(activeFilterId)
        ? activeFilterId
        : filterIds[0] ?? contentIds[0] ?? null;
      if (!focusId) return fallback;

      const filterIndex = filterIds.indexOf(focusId);
      if (filterIndex >= 0) {
        if (direction === 'right') return contentIds[0] ?? focusId;
        if (direction === 'up' || direction === 'down') {
          return filterIds[moveListIndex(filterIndex, filterIds.length, direction, wrap)];
        }
        return focusId;
      }

      const contentIndex = contentIds.indexOf(focusId);
      if (contentIndex < 0) return fallback;
      const safeColumns = Math.max(1, Math.floor(columns));
      if (direction === 'left' && (safeColumns === 1 || contentIndex % safeColumns === 0)) {
        return fallback;
      }
      return contentIds[moveGridIndex(contentIndex, safeColumns, contentIds.length, direction, wrap)];
    }
  };
}

/**
 * Now Playing focus: a timeline and transport rows beside a vertical queue
 * rail. Up/Down crosses between control rows; Left/Right moves within a row.
 * A single-control row enters the horizontal center of the next row. Queue
 * focus is by item ID so updates do not desynchronize navigation.
 */
export function createNowPlayingFocusModel(
  transportRows: readonly (readonly string[])[],
  queueIds: readonly string[],
  queueActionIds: readonly (readonly string[])[] = []
): OdaFocusModel {
  const transportIds = transportRows.flat();
  const allQueueActionIds = queueActionIds.flat();
  return {
    resolveMove: (focusId, direction, wrap) => {
      const fallback = transportIds[0] ?? queueIds[0] ?? null;
      if (!focusId) return fallback;

      const transportRowIndex = transportRows.findIndex((row) => row.includes(focusId));
      if (transportRowIndex >= 0) {
        const row = transportRows[transportRowIndex];
        const transportIndex = row.indexOf(focusId);
        if (direction === 'left' || direction === 'right') {
          if (direction === 'right' && transportIndex === row.length - 1 && transportRowIndex === transportRows.length - 1) {
            return queueIds[0] ?? focusId;
          }
          return row[moveListIndex(transportIndex, row.length, direction === 'left' ? 'up' : 'down', wrap)];
        }
        const nextRowIndex = transportRowIndex + (direction === 'up' ? -1 : 1);
        const nextRow = transportRows[nextRowIndex];
        if (nextRow) {
          const nextIndex = row.length === 1
            ? Math.floor((nextRow.length - 1) / 2)
            : clampIndex(transportIndex, nextRow.length);
          return nextRow[nextIndex] ?? focusId;
        }
        return direction === 'down' ? queueIds[0] ?? focusId : focusId;
      }

      const queueIndex = queueIds.indexOf(focusId);
      if (queueIndex >= 0) {
        if (direction === 'left') return transportIds[transportIds.length - 1] ?? focusId;
        if (direction === 'right') return queueActionIds[queueIndex]?.[0] ?? focusId;
        if (direction === 'up') {
          if (queueIndex === 0) return transportIds[transportIds.length - 1] ?? focusId;
          return queueIds[queueIndex - 1];
        }
        if (direction === 'down') {
          return queueIds[moveListIndex(queueIndex, queueIds.length, 'down', wrap)];
        }
        return focusId;
      }

      const actionIndex = allQueueActionIds.indexOf(focusId);
      if (actionIndex >= 0) {
        const queueIndexForAction = queueActionIds.findIndex((ids) => ids.includes(focusId));
        const rowActions = queueActionIds[queueIndexForAction] ?? [];
        const rowActionIndex = rowActions.indexOf(focusId);
        if (direction === 'left') {
          return rowActionIndex > 0
            ? rowActions[rowActionIndex - 1]
            : queueIds[queueIndexForAction] ?? focusId;
        }
        if (direction === 'right') {
          return rowActions[Math.min(rowActionIndex + 1, rowActions.length - 1)] ?? focusId;
        }
        const nextQueueIndex = moveListIndex(
          queueIndexForAction,
          queueIds.length,
          direction,
          wrap
        );
        const nextActions = queueActionIds[nextQueueIndex] ?? [];
        return nextActions[clampIndex(rowActionIndex, nextActions.length)]
          ?? queueIds[nextQueueIndex]
          ?? focusId;
      }

      return fallback;
    }
  };
}

/** The home waterfall model. */
export function createWaterfallFocusModel(
  sections: readonly OdaWaterfallSection[]
): OdaFocusModel {
  return {
    resolveMove: (focusId, direction, wrap) => {
      const focus = findWaterfallFocus(focusId, sections) ?? initialWaterfallFocus(sections);
      return waterfallFocusId(moveWaterfall(focus, sections, direction, wrap), sections);
    }
  };
}
