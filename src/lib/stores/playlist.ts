import { derived, writable } from 'svelte/store';
import type { PlaylistItem } from '$lib/types';

function createPlaylistStore() {
  const items = writable<PlaylistItem[]>([]);
  const currentId = writable<string | null>(null);

  const currentTrack = derived([items, currentId], ([$items, $currentId]) => {
    if (!$currentId) {
      return null;
    }

    return $items.find((item) => item.id === $currentId) ?? null;
  });

  return {
    items,
    currentId,
    currentTrack,
    add(newItems: PlaylistItem[]) {
      items.update((existing) => [...existing, ...newItems]);
      currentId.update((id) => id ?? newItems[0]?.id ?? null);
    },
    select(id: string) {
      currentId.set(id);
    },
    updateMetadata(id: string, metadata: PlaylistItem['metadata']) {
      items.update((existing) =>
        existing.map((item) =>
          item.id === id
            ? {
                ...item,
                metadata: { ...item.metadata, ...metadata }
              }
            : item
        )
      );
    }
  };
}

export const playlistStore = createPlaylistStore();
