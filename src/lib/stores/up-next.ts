import { writable } from 'svelte/store';
import { logInfo } from '$lib/services/logging';
import type { TrackItem } from '$lib/types';
import { getFavoriteIdentity } from '$lib/utils/files';

export interface UpNextEntry {
  id: string;
  identity: string;
}

type UpNextPosition = 'front' | 'end';

function buildEntries(items: TrackItem[]): UpNextEntry[] {
  return items.map((item) => ({
    id: item.id,
    identity: getFavoriteIdentity(item)
  }));
}

/**
 * Playback queue ("up next"). Transient playback state: queue entries are
 * queue store ids, so items resolve and materialize through the queue.
 * Not persisted.
 */
function createUpNextStore() {
  let entries: UpNextEntry[] = [];
  const store = writable<UpNextEntry[]>([]);

  store.subscribe((value) => {
    entries = value;
  });

  function publish(): void {
    store.set(entries);
  }

  return {
    subscribe: store.subscribe,
    getEntries(): UpNextEntry[] {
      return entries;
    },
    getIds(): string[] {
      return entries.map((entry) => entry.id);
    },
    add(items: TrackItem[], position: UpNextPosition): void {
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
    peek(): UpNextEntry | null {
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

export const upNext = createUpNextStore();
