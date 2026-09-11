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
  odaTrackFocusId,
  resolveOdaBrowseGroup
} from './oda-browse';
import {
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
  resolveOdaNowPlayingTransportIds
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
      ...context.queueItems.map((item) => odaTrackFocusId(item.id))
    ];
  }
  if (route.name === 'video-theater') return resolveOdaTheaterControlIds('video');
  if (route.name === 'image-theater') return resolveOdaTheaterControlIds('image');
  if (route.name === 'browse' && isOdaGroupedBrowseView(route.view) && !route.groupKey) {
    return buildOdaBrowseGroupRows(context.musicItems, route.view).map((row) => row.focusId);
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
      resolveOdaNowPlayingTransportIds(),
      context.queueItems.map((item) => odaTrackFocusId(item.id))
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
