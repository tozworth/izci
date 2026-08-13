import type { MediaEntity } from '$lib/contracts/catalog';
import { getTrackIdentity } from '$lib/utils/files';

export function splitUniqueItems(
  sourceItems: MediaEntity[],
  options: {
    dedupe: boolean;
    existingItems?: MediaEntity[];
    getIdentity?: (item: MediaEntity) => string;
  }
): {
  uniqueItems: MediaEntity[];
  duplicateItems: MediaEntity[];
} {
  const { dedupe, existingItems = [], getIdentity = getTrackIdentity } = options;

  if (!dedupe) {
    return {
      uniqueItems: [...sourceItems],
      duplicateItems: []
    };
  }

  const seen = new Set(existingItems.map((item) => getIdentity(item)));
  const uniqueItems: MediaEntity[] = [];
  const duplicateItems: MediaEntity[] = [];

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
