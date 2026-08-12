import type { PlaylistItem, PlaylistSelection } from '$lib/contracts/catalog';

function getOrderedIds(displayItems: PlaylistItem[], ids: Iterable<string>): string[] {
  const idSet = new Set(ids);
  return displayItems.filter((item) => idSet.has(item.id)).map((item) => item.id);
}

function getRangeIds(displayItems: PlaylistItem[], fromId: string, toId: string): string[] {
  const orderedIds = displayItems.map((item) => item.id);
  const fromIndex = orderedIds.indexOf(fromId);
  const toIndex = orderedIds.indexOf(toId);

  if (fromIndex === -1 || toIndex === -1) {
    return [toId];
  }

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);

  return orderedIds.slice(start, end + 1);
}

export function isToggleSelection(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

export function buildOrderedSelection(
  displayItems: PlaylistItem[],
  selectedIds: string[],
  selectionAnchorId: string | null,
  id: string,
  range: boolean,
  toggle: boolean
): PlaylistSelection {
  const orderedSelectedIds = getOrderedIds(displayItems, selectedIds);

  if (range) {
    const anchorId =
      selectionAnchorId && displayItems.some((item) => item.id === selectionAnchorId) ? selectionAnchorId : id;
    const rangeIds = getRangeIds(displayItems, anchorId, id);

    return {
      ids: toggle ? getOrderedIds(displayItems, new Set([...orderedSelectedIds, ...rangeIds])) : rangeIds,
      anchorId,
      focusId: id
    };
  }

  if (toggle) {
    const ids = orderedSelectedIds.includes(id)
      ? orderedSelectedIds.filter((selectedId) => selectedId !== id)
      : getOrderedIds(displayItems, [...orderedSelectedIds, id]);

    return {
      ids,
      anchorId: ids.length > 0 ? id : null,
      focusId: ids.includes(id) ? id : ids.at(-1) ?? null
    };
  }

  return {
    ids: [id],
    anchorId: id,
    focusId: id
  };
}
