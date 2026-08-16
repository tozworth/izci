import { hasDockTabDragData, readDockTabDragData } from '$lib/components/docking/drag';
import type { DockTabDefinition, DockTabMoveDetail } from '$lib/components/docking/types';
import { resizeDockPairWeights, resolveDockSplit, resolveDockSplitWeights } from '$lib/services/dock-layout';
import {
  isTroubadourTab,
  TROUBADOUR_DOCK_REGIONS,
  TROUBADOUR_DOCK_SCOPE,
  type TroubadourDockLayout,
  type TroubadourDockRegionId,
  type TroubadourDockZoneId,
  type TroubadourTab,
  type TroubadourWorkspaceState
} from '$lib/stores/troubadour-workspace';

export type TroubadourTranslate = (
  id: string,
  options?: { default?: string; values?: Record<string, string | number | boolean | Date | null | undefined> }
) => string;

export interface TroubadourDockGuide {
  id: TroubadourDockRegionId;
  icon: string;
  label: string;
  split: 'horizontal' | 'vertical';
  zones: readonly [TroubadourDockZoneId, TroubadourDockZoneId];
  zoneLabels: readonly [string, string];
}

export interface DockResizePair {
  before: TroubadourDockRegionId;
  after: TroubadourDockRegionId;
}

export function adjacentPairs<T>(items: readonly T[]): Array<{ before: T; after: T }> {
  return items.slice(0, -1).map((before, index) => ({ before, after: items[index + 1] }));
}

export function buildDockGuides(translate: TroubadourTranslate): TroubadourDockGuide[] {
  const labels: Record<TroubadourDockRegionId, { label: string; icon: string; halves: [string, string] }> = {
    top: {
      label: translate('troubadour.dock.top', { default: 'Top zones' }),
      icon: 'vertical_align_top',
      halves: [translate('troubadour.dock.topLeft', { default: 'Top left' }), translate('troubadour.dock.topRight', { default: 'Top right' })]
    },
    left: {
      label: translate('troubadour.dock.left', { default: 'Left zones' }),
      icon: 'align_horizontal_left',
      halves: [translate('troubadour.dock.leftTop', { default: 'Left top' }), translate('troubadour.dock.leftBottom', { default: 'Left bottom' })]
    },
    middle: {
      label: translate('troubadour.dock.middle', { default: 'Middle zones' }),
      icon: 'select_window',
      halves: [translate('troubadour.dock.middleTop', { default: 'Middle top' }), translate('troubadour.dock.middleBottom', { default: 'Middle bottom' })]
    },
    right: {
      label: translate('troubadour.dock.right', { default: 'Right zones' }),
      icon: 'align_horizontal_right',
      halves: [translate('troubadour.dock.rightTop', { default: 'Right top' }), translate('troubadour.dock.rightBottom', { default: 'Right bottom' })]
    },
    bottom: {
      label: translate('troubadour.dock.bottom', { default: 'Bottom zones' }),
      icon: 'vertical_align_bottom',
      halves: [translate('troubadour.dock.bottomLeft', { default: 'Bottom left' }), translate('troubadour.dock.bottomRight', { default: 'Bottom right' })]
    }
  };

  return TROUBADOUR_DOCK_REGIONS.map((region) => ({
    ...region,
    icon: labels[region.id].icon,
    label: labels[region.id].label,
    zoneLabels: labels[region.id].halves
  }));
}

export function dockRegionLabel(regionId: TroubadourDockRegionId, translate: TroubadourTranslate): string {
  switch (regionId) {
    case 'top': return translate('troubadour.dock.top', { default: 'Top zones' });
    case 'middle': return translate('troubadour.dock.middle', { default: 'Middle zones' });
    case 'bottom': return translate('troubadour.dock.bottom', { default: 'Bottom zones' });
    case 'left': return translate('troubadour.dock.left', { default: 'Left zones' });
    case 'right': return translate('troubadour.dock.right', { default: 'Right zones' });
  }
}

export function dockRegionStyle(
  regionId: TroubadourDockRegionId,
  workspaceState: TroubadourWorkspaceState
): string {
  const region = TROUBADOUR_DOCK_REGIONS.find((candidate) => candidate.id === regionId)!;
  const firstVisible = workspaceState.zones[region.zones[0]].length > 0;
  const secondVisible = workspaceState.zones[region.zones[1]].length > 0;
  const split = workspaceState.layout.splits[regionId];
  const weights = resolveDockSplitWeights(firstVisible, secondVisible, split);

  return [
    `--dock-first-zone-track: ${firstVisible ? `minmax(0, ${weights.first}fr)` : '0px'}`,
    `--dock-half-resizer-track: ${firstVisible && secondVisible ? '3px' : '0px'}`,
    `--dock-second-zone-track: ${secondVisible ? `minmax(0, ${weights.second}fr)` : '0px'}`
  ].join('; ');
}

export function dockLayoutStyle(options: {
  visibleDockRows: readonly TroubadourDockRegionId[];
  visibleDockColumns: readonly TroubadourDockRegionId[];
  dockRowResizePairs: readonly DockResizePair[];
  dockColumnResizePairs: readonly DockResizePair[];
  hasMainDockRegion: boolean;
  dockRowWeights: Record<'top' | 'middle' | 'bottom', number>;
  dockColumnWeights: Record<'left' | 'middle' | 'right', number>;
}): string {
  return [
    `--dock-top-track: ${options.visibleDockRows.includes('top') ? `minmax(0, ${options.dockRowWeights.top}fr)` : '0px'}`,
    `--dock-after-top-track: ${options.dockRowResizePairs.some((pair) => pair.before === 'top') ? '3px' : '0px'}`,
    `--dock-main-track: ${options.hasMainDockRegion ? `minmax(0, ${options.dockRowWeights.middle}fr)` : '0px'}`,
    `--dock-after-middle-row-track: ${options.dockRowResizePairs.some((pair) => pair.before === 'middle') ? '3px' : '0px'}`,
    `--dock-bottom-track: ${options.visibleDockRows.includes('bottom') ? `minmax(0, ${options.dockRowWeights.bottom}fr)` : '0px'}`,
    `--dock-left-track: ${options.visibleDockColumns.includes('left') ? `minmax(0, ${options.dockColumnWeights.left}fr)` : '0px'}`,
    `--dock-after-left-track: ${options.dockColumnResizePairs.some((pair) => pair.before === 'left') ? '3px' : '0px'}`,
    `--dock-middle-track: ${options.visibleDockColumns.includes('middle') ? `minmax(0, ${options.dockColumnWeights.middle}fr)` : options.hasMainDockRegion ? '0px' : 'minmax(0, 1fr)'}`,
    `--dock-after-middle-column-track: ${options.dockColumnResizePairs.some((pair) => pair.before === 'middle') ? '3px' : '0px'}`,
    `--dock-right-track: ${options.visibleDockColumns.includes('right') ? `minmax(0, ${options.dockColumnWeights.right}fr)` : '0px'}`
  ].join('; ');
}

export function dockTabDefinitions(
  translate: TroubadourTranslate,
  spectrogramDisabled: boolean
): Record<TroubadourTab, DockTabDefinition> {
  return {
    files: { id: 'files', icon: 'audio_file', label: translate('troubadour.workbench.files', { default: 'Files' }) },
    albums: { id: 'albums', icon: 'album', label: translate('troubadour.workbench.albums', { default: 'Albums' }) },
    metadata: { id: 'metadata', icon: 'library_music', label: translate('troubadour.workbench.metadataTab', { default: 'Metadata' }) },
    rename: { id: 'rename', icon: 'drive_file_rename_outline', label: translate('troubadour.workbench.renameTab', { default: 'Rename' }) },
    lyrics: { id: 'lyrics', icon: 'lyrics', label: translate('troubadour.lyrics.tab', { default: 'Lyrics' }) },
    loudness: { id: 'loudness', icon: 'graphic_eq', label: translate('loudness.title', { default: 'Loudness' }) },
    spectrogram: {
      id: 'spectrogram',
      icon: 'waterfall_chart',
      label: translate('spectrogram.title', { default: 'Spectrogram' }),
      disabled: spectrogramDisabled
    }
  } satisfies Record<TroubadourTab, DockTabDefinition>;
}

export function replaceDockLayoutAxis(
  layout: TroubadourDockLayout,
  axis: 'rows' | 'columns',
  before: string,
  after: string,
  beforeWeight: number,
  afterWeight: number
): TroubadourDockLayout {
  return {
    ...layout,
    [axis]: {
      ...layout[axis],
      [before]: beforeWeight,
      [after]: afterWeight
    }
  } as TroubadourDockLayout;
}

export function getMainResizeElement(
  workspaceElement: HTMLElement,
  visibleDockColumns: readonly TroubadourDockRegionId[],
  regionId: TroubadourDockRegionId
): HTMLElement | null {
  if (regionId !== 'middle' || visibleDockColumns.includes('middle')) {
    return workspaceElement.querySelector<HTMLElement>(`[data-dock-region="${regionId}"]`);
  }

  const middleBandRegion = visibleDockColumns[0];
  return middleBandRegion
    ? workspaceElement.querySelector<HTMLElement>(`[data-dock-region="${middleBandRegion}"]`)
    : null;
}

/**
 * Starts a main dock-axis resize drag. Returns the stop/cleanup function, or null
 * when the target regions are not present in the DOM. The caller is responsible
 * for tracking the cleanup handle and the `is-resizing` state.
 */
export function startMainDockResize(
  workspaceElement: HTMLElement,
  visibleDockColumns: readonly TroubadourDockRegionId[],
  layout: TroubadourDockLayout,
  axis: 'rows' | 'columns',
  before: TroubadourDockRegionId,
  after: TroubadourDockRegionId,
  event: PointerEvent,
  onLayout: (layout: TroubadourDockLayout) => void,
  cancelPrevious?: () => void
): (() => void) | null {
  const beforeElement = getMainResizeElement(workspaceElement, visibleDockColumns, before);
  const afterElement = getMainResizeElement(workspaceElement, visibleDockColumns, after);

  if (!beforeElement || !afterElement) return null;

  event.preventDefault();
  cancelPrevious?.();
  const beforeBounds = beforeElement.getBoundingClientRect();
  const afterBounds = afterElement.getBoundingClientRect();
  const horizontal = axis === 'columns';
  const beforeSize = horizontal ? beforeBounds.width : beforeBounds.height;
  const afterSize = horizontal ? afterBounds.width : afterBounds.height;
  const startCoordinate = horizontal ? event.clientX : event.clientY;
  const startLayout = layout;
  const axisLayout = startLayout[axis] as Record<string, number>;

  const move = (moveEvent: PointerEvent) => {
    const coordinate = horizontal ? moveEvent.clientX : moveEvent.clientY;
    const next = resizeDockPairWeights({
      beforeSize,
      afterSize,
      beforeWeight: axisLayout[before],
      afterWeight: axisLayout[after],
      delta: coordinate - startCoordinate,
      minimumSize: horizontal ? 140 : 84
    });
    onLayout(replaceDockLayoutAxis(
      startLayout,
      axis,
      before,
      after,
      next.beforeWeight,
      next.afterWeight
    ));
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop, { once: true });
  window.addEventListener('pointercancel', stop, { once: true });
  return stop;
}

/**
 * Starts a dock half (two-zone region) resize drag. Returns the stop/cleanup
 * function, or null when the region is not present in the DOM. The caller is
 * responsible for tracking the cleanup handle and the `is-resizing` state.
 */
export function startDockHalfResize(
  workspaceElement: HTMLElement,
  layout: TroubadourDockLayout,
  regionId: TroubadourDockRegionId,
  event: PointerEvent,
  onLayout: (layout: TroubadourDockLayout) => void,
  cancelPrevious?: () => void
): (() => void) | null {
  const region = TROUBADOUR_DOCK_REGIONS.find((candidate) => candidate.id === regionId);
  const regionElement = workspaceElement.querySelector<HTMLElement>(`[data-dock-region="${regionId}"]`);

  if (!region || !regionElement) return null;

  event.preventDefault();
  cancelPrevious?.();
  const bounds = regionElement.getBoundingClientRect();
  const horizontal = region.split === 'horizontal';
  const startLayout = layout;

  const move = (moveEvent: PointerEvent) => {
    const dimension = horizontal ? bounds.width : bounds.height;
    const position = horizontal
      ? moveEvent.clientX - bounds.left
      : moveEvent.clientY - bounds.top;
    const split = resolveDockSplit(position, dimension, horizontal ? 120 : 72);
    onLayout({
      ...startLayout,
      splits: { ...startLayout.splits, [regionId]: split }
    });
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop, { once: true });
  window.addEventListener('pointercancel', stop, { once: true });
  return stop;
}

export interface TroubadourDockTabTarget {
  moveTab(detail: DockTabMoveDetail): void;
  /** Current drop-highlight zone id, read by the drag-leave handler. */
  dropZoneId: TroubadourDockZoneId | null;
  setDraggedTabId(tabId: TroubadourTab | null): void;
  setDropZoneId(zoneId: TroubadourDockZoneId | null): void;
  setDragActive(active: boolean): void;
}

export function moveDockTab(target: TroubadourDockTabTarget, detail: DockTabMoveDetail): void {
  target.moveTab(detail);
  target.setDraggedTabId(null);
  target.setDropZoneId(null);
}

export function handleDockTabDragStart(target: TroubadourDockTabTarget, tabId: string): void {
  target.setDraggedTabId(isTroubadourTab(tabId) ? tabId : null);
  target.setDragActive(false);
}

export function handleDockTabDragEnd(target: TroubadourDockTabTarget): void {
  target.setDraggedTabId(null);
  target.setDropZoneId(null);
}

export function handleDockPanelDragOver(
  target: TroubadourDockTabTarget,
  event: DragEvent,
  zoneId: TroubadourDockZoneId
): void {
  if (!hasDockTabDragData(event.dataTransfer, TROUBADOUR_DOCK_SCOPE)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  target.setDropZoneId(zoneId);
}

export function handleDockPanelDrop(
  target: TroubadourDockTabTarget,
  event: DragEvent,
  zoneId: TroubadourDockZoneId
): void {
  const dragData = readDockTabDragData(event.dataTransfer, TROUBADOUR_DOCK_SCOPE);

  if (!dragData) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  moveDockTab(target, { ...dragData, targetZoneId: zoneId, position: 'end' });
}

export function handleDockPanelDragLeave(
  target: TroubadourDockTabTarget,
  event: DragEvent,
  zoneId: TroubadourDockZoneId
): void {
  if (
    event.relatedTarget instanceof Node &&
    event.currentTarget instanceof HTMLElement &&
    event.currentTarget.contains(event.relatedTarget)
  ) {
    return;
  }

  if (target.dropZoneId === zoneId) target.setDropZoneId(null);
}
