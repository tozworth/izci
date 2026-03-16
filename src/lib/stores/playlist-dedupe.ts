import type { PlaylistItem } from '$lib/types';
import { getTrackIdentity } from '$lib/utils/files';

export function splitUniqueItems(
  sourceItems: PlaylistItem[],
  options: {
    dedupe: boolean;
    existingItems?: PlaylistItem[];
  }
): {
  uniqueItems: PlaylistItem[];
  duplicateItems: PlaylistItem[];
} {
  const { dedupe, existingItems = [] } = options;

  if (!dedupe) {
    return {
      uniqueItems: [...sourceItems],
      duplicateItems: []
    };
  }

  const seen = new Set(existingItems.map((item) => getTrackIdentity(item)));
  const uniqueItems: PlaylistItem[] = [];
  const duplicateItems: PlaylistItem[] = [];

  for (const item of sourceItems) {
    const key = getTrackIdentity(item);

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
