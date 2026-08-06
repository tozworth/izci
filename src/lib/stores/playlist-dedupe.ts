import type { PlaylistItem } from '$lib/types';
import { getTrackIdentity } from '$lib/utils/files';
import { logDebug, logInfo } from '$lib/services/logging';

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
    logDebug('library', 'splitUniqueItems: no duplicates', { uniqueKept: sourceItems.length });
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

  if (duplicateItems.length > 0) {
    logInfo('library', 'splitUniqueItems: duplicates dropped', {
      uniqueKept: uniqueItems.length,
      duplicatesDropped: duplicateItems.length
    });
  } else {
    logDebug('library', 'splitUniqueItems: no duplicates', { uniqueKept: uniqueItems.length });
  }

  return {
    uniqueItems,
    duplicateItems
  };
}
