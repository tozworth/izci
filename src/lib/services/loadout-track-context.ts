import { writable, type Readable } from 'svelte/store';
import type { LoadoutTrackContext, PlaylistItem } from '$lib/types';

const CHANNEL_NAME = 'izci-loadout-track-context';
const store = writable<LoadoutTrackContext | null>(null);
let channel: BroadcastChannel | null = null;
let publishedTrack: LoadoutTrackContext | null = null;
let publisherActive = false;

function normalizeTrackContext(value: unknown): LoadoutTrackContext | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<LoadoutTrackContext>;
  if (
    typeof source.name !== 'string' ||
    typeof source.extension !== 'string' ||
    (source.kind !== 'stream' && source.kind !== 'module' && source.kind !== 'video') ||
    typeof source.size !== 'number' ||
    typeof source.lastModified !== 'number'
  ) return null;

  return {
    name: source.name,
    path: typeof source.path === 'string' ? source.path : undefined,
    sourceFolderId: typeof source.sourceFolderId === 'string' ? source.sourceFolderId : undefined,
    extension: source.extension,
    kind: source.kind,
    size: source.size,
    lastModified: source.lastModified,
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : undefined
  };
}

export function toLoadoutTrackContext(track: PlaylistItem | null): LoadoutTrackContext | null {
  if (!track) return null;
  return normalizeTrackContext(track);
}

function postTrackContext(): void {
  channel?.postMessage({ type: 'track', track: publishedTrack });
}

if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', (event) => {
    if (event.data?.type === 'request' && publisherActive) {
      postTrackContext();
    } else if (event.data?.type === 'track') {
      store.set(normalizeTrackContext(event.data.track));
    }
  });
}

export const loadoutTrackContext = {
  subscribe: store.subscribe,
  request(): void {
    channel?.postMessage({ type: 'request' });
  }
};

export function startLoadoutTrackContextPublisher(
  trackStore: Readable<PlaylistItem | null>
): () => void {
  publisherActive = true;
  const unsubscribe = trackStore.subscribe((track) => {
    publishedTrack = toLoadoutTrackContext(track);
    postTrackContext();
  });

  return () => {
    unsubscribe();
    publisherActive = false;
    publishedTrack = null;
    postTrackContext();
  };
}
