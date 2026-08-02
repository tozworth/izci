import type { MenuActionItem, PlaylistItem } from '$lib/types';

export const TRACK_RATING_VALUES = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);
export const TRACK_RATING_ACTION_PREFIX = 'rate:';

export function normalizeTrackRating(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.min(5, Math.max(0.5, Math.round(value * 2) / 2));
}

export function formatTrackRating(value: unknown): string {
  const rating = normalizeTrackRating(value);
  return rating === undefined ? '' : String(rating);
}

export function buildTrackRatingAction(tracks: PlaylistItem[]): MenuActionItem {
  const ratings = tracks.map((track) => normalizeTrackRating(track.rating));
  const commonRating = ratings.length > 0 && ratings.every((rating) => rating === ratings[0])
    ? ratings[0]
    : undefined;

  return {
    id: 'rate',
    label: 'Rate',
    icon: 'star',
    ratingPicker: {
      value: commonRating ?? 0,
      actionPrefix: TRACK_RATING_ACTION_PREFIX
    }
  };
}

export function parseTrackRatingAction(actionId: string): { matched: boolean; rating?: number } {
  if (!actionId.startsWith(TRACK_RATING_ACTION_PREFIX)) {
    return { matched: false };
  }

  const value = actionId.slice(TRACK_RATING_ACTION_PREFIX.length);
  if (value === 'clear') {
    return { matched: true };
  }

  const rating = normalizeTrackRating(Number(value));
  return rating === undefined ? { matched: false } : { matched: true, rating };
}
