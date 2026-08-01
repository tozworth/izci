import type { DockTabMoveDetail } from '$lib/components/docking/types';

interface DockPairResizeOptions {
  beforeSize: number;
  afterSize: number;
  beforeWeight: number;
  afterWeight: number;
  delta: number;
  minimumSize: number;
}

export function normalizeVisibleDockWeights<TId extends string>(
  weights: Record<TId, number>,
  visibleIds: readonly TId[]
): Record<TId, number> {
  const visible = new Set(visibleIds);
  const total = visibleIds.reduce((sum, id) => sum + weights[id], 0);

  return Object.fromEntries(
    Object.entries(weights).map(([id, weight]) => [
      id,
      visible.has(id as TId) && total > 0 ? (weight as number) / total : 0
    ])
  ) as Record<TId, number>;
}

export function resolveDockSplitWeights(
  firstVisible: boolean,
  secondVisible: boolean,
  split: number
): { first: number; second: number } {
  if (firstVisible && secondVisible) {
    return { first: split, second: 1 - split };
  }

  return {
    first: firstVisible ? 1 : 0,
    second: secondVisible ? 1 : 0
  };
}

export function resizeDockPairWeights({
  beforeSize,
  afterSize,
  beforeWeight,
  afterWeight,
  delta,
  minimumSize
}: DockPairResizeOptions): { beforeWeight: number; afterWeight: number } {
  const combinedSize = beforeSize + afterSize;
  const combinedWeight = beforeWeight + afterWeight;

  if (combinedSize <= 0 || combinedWeight <= 0) {
    return { beforeWeight, afterWeight };
  }

  const boundedMinimum = Math.min(Math.max(0, minimumSize), combinedSize * 0.5);
  const nextBeforeSize = Math.min(
    combinedSize - boundedMinimum,
    Math.max(boundedMinimum, beforeSize + delta)
  );
  const nextBeforeWeight = combinedWeight * (nextBeforeSize / combinedSize);

  return {
    beforeWeight: nextBeforeWeight,
    afterWeight: combinedWeight - nextBeforeWeight
  };
}

export function resolveDockSplit(
  position: number,
  dimension: number,
  minimumSize: number
): number {
  const safeDimension = Math.max(dimension, 1);
  const minimumFraction = Math.min(0.42, Math.max(0, minimumSize) / safeDimension);

  return Math.min(
    1 - minimumFraction,
    Math.max(minimumFraction, position / safeDimension)
  );
}

export function findDockTabZone<TTab extends string, TZone extends string>(
  zones: Record<TZone, TTab[]>,
  zoneIds: readonly TZone[],
  tabId: TTab
): TZone | null {
  return zoneIds.find((zoneId) => zones[zoneId].includes(tabId)) ?? null;
}

export function moveDockTab<TTab extends string, TZone extends string>(
  zones: Record<TZone, TTab[]>,
  zoneIds: readonly TZone[],
  detail: DockTabMoveDetail
): Record<TZone, TTab[]> {
  const tabId = detail.tabId as TTab;
  const targetZoneId = detail.targetZoneId as TZone | undefined;
  const sourceZoneId = findDockTabZone(zones, zoneIds, tabId);

  if (!sourceZoneId || !targetZoneId || !zoneIds.includes(targetZoneId)) {
    return zones;
  }

  if (
    sourceZoneId === targetZoneId &&
    detail.targetTabId === tabId &&
    detail.position !== 'end'
  ) {
    return zones;
  }

  const nextZones = Object.fromEntries(
    zoneIds.map((zoneId) => [zoneId, zones[zoneId].filter((candidate) => candidate !== tabId)])
  ) as Record<TZone, TTab[]>;
  const targetTabs = nextZones[targetZoneId];
  let insertIndex = targetTabs.length;

  if (detail.targetTabId && detail.targetTabId !== tabId) {
    const targetIndex = targetTabs.indexOf(detail.targetTabId as TTab);

    if (targetIndex >= 0) {
      insertIndex = detail.position === 'before' ? targetIndex : targetIndex + 1;
    }
  }

  targetTabs.splice(insertIndex, 0, tabId);
  return nextZones;
}
