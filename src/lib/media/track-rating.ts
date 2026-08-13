export const TRACK_RATING_VALUES = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);
export const TRACK_RATING_ACTION_PREFIX = 'rate:';

export function normalizeTrackRating(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(5, Math.max(0.5, Math.round(value * 2) / 2));
}

export function formatTrackRating(value: unknown): string {
  const rating = normalizeTrackRating(value);
  return rating === undefined ? '' : String(rating);
}
