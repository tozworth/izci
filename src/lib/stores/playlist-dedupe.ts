import type { PlaylistItem } from '$lib/contracts/catalog';
import { getTrackIdentity } from '$lib/utils/files';

export function splitUniqueItems(
  sourceItems: PlaylistItem[],
  options: {
    dedupe: boolean;
    existingItems?: PlaylistItem[];
    getIdentity?: (item: PlaylistItem) => string;
  }
): {
  uniqueItems: PlaylistItem[];
  duplicateItems: PlaylistItem[];
} {
  const { dedupe, existingItems = [], getIdentity = getTrackIdentity } = options;

  if (!dedupe) {
    return {
      uniqueItems: [...sourceItems],
      duplicateItems: []
    };
  }

  const seen = new Set(existingItems.map((item) => getIdentity(item)));
  const uniqueItems: PlaylistItem[] = [];
  const duplicateItems: PlaylistItem[] = [];

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
