/**
 * Main-window view-state store for the composition root.
 *
 * Holds the low-frequency local store mirrors (collections, selections,
 * selected items) that `App.svelte`'s reactive layer resolves over. These
 * change on user/library actions, not on playback timecode ticks, so a Svelte
 * `$view` store is a safe home for them. The high-frequency playback mirrors
 * (`localPlaybackSnapshot` / `localPlaybackStatus`) deliberately stay out of
 * this store: they update on every snapshot tick, and pushing them through a
 * `$:`-consumed store would re-run the component's derivation layer at
 * timecode rate. They keep flowing through the runtime's subscribe surface.
 *
 * Pure move from `App.svelte` — no behavior changes.
 */

import { get, writable } from 'svelte/store';
import type { TrackItem } from '$lib/types';
import type { UpNextEntry } from '$lib/stores/up-next';

interface MainWindowViewState {
  trackItems: TrackItem[];
  libraryItems: TrackItem[];
  favoriteItems: TrackItem[];
  upNextEntries: UpNextEntry[];
  collectionsReady: boolean;
  trackSelectionIds: string[];
  librarySelectionIds: string[];
  librarySelectionAnchorId: string | null;
  favoriteSelectionIds: string[];
  favoriteSelectionAnchorId: string | null;
  selectedTrackItem: TrackItem | null;
  selectedLibraryItem: TrackItem | null;
  selectedFavoriteItem: TrackItem | null;
}

interface MainWindowView {
  set(partial: Partial<MainWindowViewState>): void;
  getSnapshot(): MainWindowViewState;
}

export function createMainWindowView(): MainWindowView & {
  subscribe(run: (value: MainWindowViewState) => void): () => void;
} {
  const store = writable<MainWindowViewState>({
    trackItems: [],
    libraryItems: [],
    favoriteItems: [],
    upNextEntries: [],
    collectionsReady: false,
    trackSelectionIds: [],
    librarySelectionIds: [],
    librarySelectionAnchorId: null,
    favoriteSelectionIds: [],
    favoriteSelectionAnchorId: null,
    selectedTrackItem: null,
    selectedLibraryItem: null,
    selectedFavoriteItem: null
  });

  return {
    set: (partial) => store.update((current) => ({ ...current, ...partial })),
    getSnapshot: () => get(store),
    subscribe: store.subscribe
  };
}
