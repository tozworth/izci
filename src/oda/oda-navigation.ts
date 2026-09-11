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

export const INITIAL_WATERFALL_FOCUS: OdaWaterfallFocus = {
  sectionIndex: 0,
  cardIndex: 0,
  onCards: true
};

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

/**
 * Now Playing focus: a horizontal transport strip above a vertical queue
 * rail. Up/Down crosses between the strips; Left/Right only adjusts the
 * focused transport control. Queue focus is by item ID so updates do not
 * desynchronize navigation.
 */
export function createNowPlayingFocusModel(
  transportIds: readonly string[],
  queueIds: readonly string[]
): OdaFocusModel {
  return {
    resolveMove: (focusId, direction, wrap) => {
      const fallback = transportIds[0] ?? queueIds[0] ?? null;
      if (!focusId) return fallback;

      const transportIndex = transportIds.indexOf(focusId);
      if (transportIndex >= 0) {
        if (direction === 'left' || direction === 'right') {
          return transportIds[moveListIndex(transportIndex, transportIds.length, direction === 'left' ? 'up' : 'down', wrap)];
        }
        if (direction === 'down') return queueIds[0] ?? focusId;
        return focusId;
      }

      const queueIndex = queueIds.indexOf(focusId);
      if (queueIndex >= 0) {
        if (direction === 'up') {
          if (queueIndex === 0) return transportIds[transportIds.length - 1] ?? focusId;
          return queueIds[queueIndex - 1];
        }
        if (direction === 'down') {
          return queueIds[moveListIndex(queueIndex, queueIds.length, 'down', wrap)];
        }
        return focusId;
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
      const focus = findWaterfallFocus(focusId, sections) ?? INITIAL_WATERFALL_FOCUS;
      return waterfallFocusId(moveWaterfall(focus, sections, direction, wrap), sections);
    }
  };
}
