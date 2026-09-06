import { writable } from 'svelte/store';
import type { TrackItem } from '$lib/types';
import { getTrackLyricsLoadKey, loadTrackLyrics } from './lyrics';

/** Transient availability, independent of workspace tab automation. */
export function createNowPlayingLyrics() {
  const available = writable(false);
  let key: string | undefined;
  let generation = 0;
  return {
    subscribe: available.subscribe,
    setTrack(track: TrackItem | null) {
      const nextKey = getTrackLyricsLoadKey(track);
      if (nextKey === key) return;
      key = nextKey;
      const token = ++generation;
      available.set(false);
      void loadTrackLyrics(track).then(lyrics => {
        if (token === generation) available.set(Boolean(lyrics));
      }).catch(() => { if (token === generation) available.set(false); });
    },
    destroy() { generation++; }
  };
}
