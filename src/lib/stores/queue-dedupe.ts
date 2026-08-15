import type { TrackItem } from '$lib/types';
import { getTrackIdentity } from '$lib/utils/files';

export function splitUniqueItems(
  sourceItems: TrackItem[],
  options: {
    dedupe: boolean;
    existingItems?: TrackItem[];
    getIdentity?: (item: TrackItem) => string;
  }
): {
  uniqueItems: TrackItem[];
  duplicateItems: TrackItem[];
} {
  const { dedupe, existingItems = [], getIdentity = getTrackIdentity } = options;

  if (!dedupe) {
    return {
      uniqueItems: [...sourceItems],
      duplicateItems: []
    };
  }

  const seen = new Set(existingItems.map((item) => getIdentity(item)));
  const uniqueItems: TrackItem[] = [];
  const duplicateItems: TrackItem[] = [];

  for (const item of sourceItems) {
    const key = getIdentity(item);

    if (seen.has(key)) {
      duplicateItems.push(item);
      continue;
    }

    seen.add(key);
    uniqueItems.push(item);
  }

  return {
    uniqueItems,
    duplicateItems
  };
}
