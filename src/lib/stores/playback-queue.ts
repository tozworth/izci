import { writable } from 'svelte/store';
import { logInfo } from '$lib/services/logging';
import type { PlaylistItem } from '$lib/types';
import { getFavoriteIdentity } from '$lib/utils/files';

export interface QueueEntry {
  id: string;
  identity: string;
}

export type QueuePosition = 'front' | 'end';

function buildEntries(items: PlaylistItem[]): QueueEntry[] {
  return items.map((item) => ({
    id: item.id,
    identity: getFavoriteIdentity(item)
  }));
}

/**
 * Playback queue ("up next"). Transient playback state: queue entries are
 * playlist store ids, so items resolve and materialize through the playlist.
 * Not persisted.
 */
function createPlaybackQueueStore() {
  let entries: QueueEntry[] = [];
  const store = writable<QueueEntry[]>([]);

  store.subscribe((value) => {
    entries = value;
  });

  function publish(): void {
    store.set(entries);
  }

  return {
    subscribe: store.subscribe,
    getEntries(): QueueEntry[] {
      return entries;
    },
    getIds(): string[] {
      return entries.map((entry) => entry.id);
    },
    add(items: PlaylistItem[], position: QueuePosition): void {
      const nextEntries = buildEntries(items);

      if (nextEntries.length === 0) {
        return;
      }

      entries = position === 'front'
        ? [...nextEntries, ...entries]
        : [...entries, ...nextEntries];

      logInfo('playback', 'Tracks queued', { added: nextEntries.length, position });
      publish();
    },
    remove(ids: string[]): void {
      if (ids.length === 0 || entries.length === 0) {
        return;
      }

      const removeSet = new Set(ids);
      const nextEntries = entries.filter((entry) => !removeSet.has(entry.id));

      if (nextEntries.length === entries.length) {
        return;
      }

      entries = nextEntries;
      publish();
    },
    removeFirstById(id: string): void {
      const index = entries.findIndex((entry) => entry.id === id);

      if (index < 0) {
        return;
      }

      entries = [...entries.slice(0, index), ...entries.slice(index + 1)];
      publish();
    },
    removeByIdentity(identity: string): void {
      if (entries.length === 0) {
        return;
      }

      const nextEntries = entries.filter((entry) => entry.identity !== identity);

      if (nextEntries.length === entries.length) {
        return;
      }

      entries = nextEntries;
      publish();
    },
    prune(validIds: Iterable<string>): void {
      if (entries.length === 0) {
        return;
      }

      const valid = new Set(validIds);
      const nextEntries = entries.filter((entry) => valid.has(entry.id));

      if (nextEntries.length === entries.length) {
        return;
      }

      entries = nextEntries;
      publish();
    },
    peek(): QueueEntry | null {
      return entries[0] ?? null;
    },
    clear(): void {
      if (entries.length === 0) {
        return;
      }

      entries = [];
      logInfo('playback', 'Queue cleared');
      publish();
    }
  };
}

export const playbackQueue = createPlaybackQueueStore();
