import type { MenuActionItem } from '$lib/contracts/window-menu';
import type { MediaEntity } from '$lib/contracts/catalog';
export {
  formatTrackRating,
  normalizeTrackRating,
  TRACK_RATING_ACTION_PREFIX,
  TRACK_RATING_VALUES
} from '$lib/media/track-rating';
import { normalizeTrackRating, TRACK_RATING_ACTION_PREFIX } from '$lib/media/track-rating';

export function buildTrackRatingAction(tracks: MediaEntity[]): MenuActionItem {
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
