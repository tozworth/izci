import type { PlaylistItem, PlaylistSelection } from '$lib/contracts/catalog';

export interface SelectOptions {
  range?: boolean;
  toggle?: boolean;
}

export const emptySelection: PlaylistSelection = {
  ids: [],
  anchorId: null,
  focusId: null
};

function orderIds(items: PlaylistItem[], ids: Iterable<string>): string[] {
  const selected = new Set(ids);
  return items.filter((item) => selected.has(item.id)).map((item) => item.id);
}

function rangeIds(items: PlaylistItem[], fromId: string, toId: string): string[] {
  const fromIndex = items.findIndex((item) => item.id === fromId);
  const toIndex = items.findIndex((item) => item.id === toId);

  if (fromIndex === -1 || toIndex === -1) {
    return [toId];
  }

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);

  return items.slice(start, end + 1).map((item) => item.id);
}

export function normalizeSelection(items: PlaylistItem[], nextSelection: PlaylistSelection): PlaylistSelection {
  const ids = orderIds(items, nextSelection.ids);
  const focusId = ids.includes(nextSelection.focusId ?? '') ? nextSelection.focusId : ids.at(-1) ?? null;
  const anchorId =
    ids.includes(nextSelection.anchorId ?? '') || items.some((item) => item.id === nextSelection.anchorId)
      ? nextSelection.anchorId
      : focusId;

  if (ids.length === 0) {
    return emptySelection;
  }

  return {
    ids,
    anchorId,
    focusId
  };
}

export function normalizeStoredSelection(value: unknown, itemIds: Set<string>): PlaylistSelection {
  const source = value && typeof value === 'object' ? (value as Partial<PlaylistSelection>) : {};
  const ids = Array.isArray(source.ids) ? source.ids.filter((id): id is string => typeof id === 'string' && itemIds.has(id)) : [];
  const focusId = typeof source.focusId === 'string' && itemIds.has(source.focusId) ? source.focusId : ids.at(-1) ?? null;
  const anchorId =
    typeof source.anchorId === 'string' && itemIds.has(source.anchorId) ? source.anchorId : focusId;

  if (ids.length === 0) {
    return emptySelection;
  }

  return {
    ids,
    anchorId,
    focusId
  };
}

export function resolveSelectSelection(
  items: PlaylistItem[],
  currentSelection: PlaylistSelection,
  id: string,
  options: SelectOptions = {}
): PlaylistSelection {
  const { range = false, toggle = false } = options;

  if (!items.some((item) => item.id === id)) {
    return normalizeSelection(items, currentSelection);
  }

  if (range) {
    const anchorId = currentSelection.anchorId ?? currentSelection.focusId ?? id;
    const ids = toggle
      ? orderIds(items, new Set([...currentSelection.ids, ...rangeIds(items, anchorId, id)]))
      : rangeIds(items, anchorId, id);

    return normalizeSelection(items, {
      ids,
      anchorId,
      focusId: id
    });
  }

  if (toggle) {
    const ids = currentSelection.ids.includes(id)
      ? currentSelection.ids.filter((selectedId) => selectedId !== id)
      : orderIds(items, [...currentSelection.ids, id]);

    return normalizeSelection(items, {
      ids,
      anchorId: ids.length > 0 ? id : null,
      focusId: ids.includes(id) ? id : ids.at(-1) ?? null
    });
  }

  return normalizeSelection(items, {
    ids: [id],
    anchorId: id,
    focusId: id
  });
}

export function buildSelectAllSelection(items: PlaylistItem[]): PlaylistSelection {
  if (items.length === 0) {
    return emptySelection;
  }

  const ids = items.map((item) => item.id);

  return {
    ids,
    anchorId: ids[0] ?? null,
    focusId: ids.at(-1) ?? null
  };
}

export function removeIdsFromSelection(
  items: PlaylistItem[],
  selection: PlaylistSelection,
  idsToRemove: Set<string>,
  previousItems: PlaylistItem[] = items
): PlaylistSelection {
  const ids = selection.ids.filter((id) => !idsToRemove.has(id));

  if (ids.length > 0 || selection.ids.every((id) => !idsToRemove.has(id))) {
    return normalizeSelection(items, {
      ids,
      anchorId: idsToRemove.has(selection.anchorId ?? '') ? null : selection.anchorId,
      focusId: idsToRemove.has(selection.focusId ?? '') ? null : selection.focusId
    });
  }

  const removedIndexes = previousItems
    .map((item, index) => (idsToRemove.has(item.id) ? index : -1))
    .filter((index) => index >= 0);
  const firstRemovedIndex = Math.min(...removedIndexes);
  const fallbackIndex = Math.min(Math.max(0, firstRemovedIndex), items.length - 1);
  const nextItem = items[fallbackIndex] ?? null;

  if (!nextItem) {
    return emptySelection;
  }

  return normalizeSelection(items, {
    ids: [nextItem.id],
    anchorId: nextItem.id,
    focusId: nextItem.id
  });
}
