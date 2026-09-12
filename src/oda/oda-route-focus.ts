/**
 * Pure route-to-focus resolution for Oda.
 *
 * OdaShell owns DOM composition, but which focus IDs a route exposes and how
 * they are ordered is deterministic data. Keeping it here makes the whole
 * navigation map testable without a browser and keeps the composition root
 * thin.
 */

import type { TrackItem } from '$lib/types';
import type { OdaRoute } from '$lib/services/oda-session';
import {
  buildOdaBrowseGroupRows,
  isOdaGroupedBrowseView,
  odaBrowserFilterFocusId,
  odaBrowserLayoutFocusId,
  odaTrackFocusId,
  resolveOdaBrowserViews,
  resolveOdaBrowseGroup
} from './oda-browse';
import {
  createBrowserFocusModel,
  createListFocusModel,
  createNowPlayingFocusModel,
  createWaterfallFocusModel,
  waterfallFocusId,
  initialWaterfallFocus,
  type OdaFocusModel,
  type OdaWaterfallSection
} from './oda-navigation';
import {
  ODA_NP_PLAY_PAUSE,
  resolveOdaNowPlayingQueueActionIds,
  resolveOdaNowPlayingTransportIds,
  resolveOdaNowPlayingTransportRows
} from './oda-now-playing';
import { resolveOdaTheaterControlIds } from './oda-theater';

export interface OdaRouteFocusContext {
  musicItems: TrackItem[];
  videoItems: TrackItem[];
  imageItems: TrackItem[];
  recentsItems: TrackItem[];
  queueItems: TrackItem[];
  optionCategoryIds: string[];
  homeWaterfallSections: OdaWaterfallSection[];
  songsLayout: 'list' | 'grid';
  canMutateQueue: boolean;
  canReorderQueue: boolean;
}


function resolveBrowseContentFocusIds(
  route: Extract<OdaRoute, { name: 'browse' }>,
  context: OdaRouteFocusContext
): string[] {
  if (route.medium === 'music' && isOdaGroupedBrowseView(route.view) && !route.groupKey) {
    return buildOdaBrowseGroupRows(context.musicItems, route.view).map((row) => row.focusId);
  }
  return resolveOdaRouteTrackItems(route, context).map((item) => odaTrackFocusId(item.id));
}

function resolveBrowseFilterFocusIds(route: Extract<OdaRoute, { name: 'browse' }>): string[] {
  const filters = resolveOdaBrowserViews(route.medium)
    .map((view) => odaBrowserFilterFocusId(route.medium, view));
  return route.medium === 'music'
    ? [...filters, odaBrowserLayoutFocusId('list'), odaBrowserLayoutFocusId('grid')]
    : filters;
}

/** Tracks for the current route, filtered by media kind where relevant. */
export function resolveOdaRouteTrackItems(
  route: OdaRoute,
  context: OdaRouteFocusContext
): TrackItem[] {
  if (route.name === 'recents') return context.recentsItems;
  if (route.name === 'queue' || route.name === 'now-playing') return context.queueItems;
  if (route.name !== 'browse') return [];
  if (route.medium === 'video') return context.videoItems;
  if (route.medium === 'image') return context.imageItems;
  if (!isOdaGroupedBrowseView(route.view)) return context.musicItems;
  if (!route.groupKey) return [];
  return resolveOdaBrowseGroup(context.musicItems, route.view, route.groupKey)?.items ?? [];
}

export function resolveOdaRouteFocusIds(
  route: OdaRoute,
  context: OdaRouteFocusContext
): string[] {
  if (route.name === 'options') {
    return [...context.optionCategoryIds];
  }
  if (route.name === 'now-playing') {
    return [
      ...resolveOdaNowPlayingTransportIds(),
      ...context.queueItems.flatMap((item) => [
        odaTrackFocusId(item.id),
        ...resolveOdaNowPlayingQueueActionIds(
          item.id,
          context.canReorderQueue,
          context.canMutateQueue
        )
      ])
    ];
  }
  if (route.name === 'video-theater') return resolveOdaTheaterControlIds('video');
  if (route.name === 'image-theater') return resolveOdaTheaterControlIds('image');
  if (route.name === 'browse') {
    return [...resolveBrowseFilterFocusIds(route), ...resolveBrowseContentFocusIds(route, context)];
  }
  return resolveOdaRouteTrackItems(route, context).map((item) => odaTrackFocusId(item.id));
}

export function resolveOdaRouteDefaultFocusId(
  route: OdaRoute,
  context: OdaRouteFocusContext
): string | null {
  if (route.name === 'home') {
    return waterfallFocusId(initialWaterfallFocus(context.homeWaterfallSections), context.homeWaterfallSections);
  }
  if (route.name === 'options') {
    return context.optionCategoryIds[0] ?? null;
  }
  if (route.name === 'now-playing') return ODA_NP_PLAY_PAUSE;
  if (route.name === 'browse') {
    if (route.groupKey) {
      return resolveBrowseContentFocusIds(route, context)[0]
        ?? odaBrowserFilterFocusId(route.medium, route.view);
    }
    return odaBrowserFilterFocusId(route.medium, route.view);
  }
  return resolveOdaRouteFocusIds(route, context)[0] ?? null;
}

export function resolveOdaRouteFocusModel(
  route: OdaRoute,
  context: OdaRouteFocusContext
): OdaFocusModel | null {
  if (route.name === 'home') {
    return createWaterfallFocusModel(context.homeWaterfallSections);
  }
  if (route.name === 'options') {
    return createListFocusModel([...context.optionCategoryIds]);
  }
  if (route.name === 'now-playing') {
    return createNowPlayingFocusModel(
      resolveOdaNowPlayingTransportRows(),
      context.queueItems.map((item) => odaTrackFocusId(item.id)),
      context.queueItems.map((item) => resolveOdaNowPlayingQueueActionIds(
        item.id,
        context.canReorderQueue,
        context.canMutateQueue
      ))
    );
  }
  if (route.name === 'browse') {
    const contentIds = resolveBrowseContentFocusIds(route, context);
    const columns = route.medium !== 'music' || isOdaGroupedBrowseView(route.view) && !route.groupKey
      ? 4
      : context.songsLayout === 'grid' ? 4 : 1;
    return createBrowserFocusModel(
      resolveBrowseFilterFocusIds(route),
      odaBrowserFilterFocusId(route.medium, route.view),
      contentIds,
      columns
    );
  }
  return createListFocusModel(resolveOdaRouteFocusIds(route, context));
}

export function odaRouteFocusIdExists(
  route: OdaRoute,
  focusId: string,
  context: OdaRouteFocusContext
): boolean {
  return resolveOdaRouteFocusIds(route, context).includes(focusId);
}
