import {
  ALBUM_ARTWORK_THUMBNAIL_SIZE,
  getCachedArtworkThumbnail,
  type CachedArtworkThumbnail
} from '$lib/services/artwork-cache';
import type { TrackItem } from '$lib/types';

export interface AlbumArtworkGroup {
  key: string;
  items: TrackItem[];
}

export type AlbumArtworkUrls = Record<string, string>;

type ThumbnailLoader = (
  track: TrackItem,
  maxEdge: number
) => Promise<CachedArtworkThumbnail | null>;

interface AlbumAssignment {
  assetId: string;
  url: string;
}

const MAX_CONCURRENT_LOADS = 3;

function getGroupSignature(group: AlbumArtworkGroup): string {
  return group.items
    .map((item) => `${item.id}:${item.extension}:${item.size}:${item.lastModified}`)
    .join('|');
}

export function createAlbumArtworkController(options: {
  loadThumbnail?: ThumbnailLoader;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
} = {}) {
  const loadThumbnail = options.loadThumbnail ?? getCachedArtworkThumbnail;
  const createObjectUrl = options.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const listeners = new Set<(urls: AlbumArtworkUrls) => void>();
  const assignments = new Map<string, AlbumAssignment>();
  const groupSignatures = new Map<string, string>();
  const resolvedGroups = new Set<string>();
  const assetUrls = new Map<string, { url: string; references: number }>();
  let snapshot: AlbumArtworkUrls = {};
  let activeSyncSignature = '';
  let syncToken = 0;
  let destroyed = false;

  function emit(): void {
    snapshot = Object.fromEntries(Array.from(assignments, ([key, assignment]) => [key, assignment.url]));
    for (const listener of listeners) listener(snapshot);
  }

  function releaseAssignment(groupKey: string): void {
    const assignment = assignments.get(groupKey);

    if (!assignment) {
      return;
    }

    assignments.delete(groupKey);
    const sharedUrl = assetUrls.get(assignment.assetId);

    if (!sharedUrl) {
      return;
    }

    sharedUrl.references -= 1;

    if (sharedUrl.references <= 0) {
      revokeObjectUrl(sharedUrl.url);
      assetUrls.delete(assignment.assetId);
    }
  }

  function assign(groupKey: string, thumbnail: CachedArtworkThumbnail): void {
    releaseAssignment(groupKey);
    let sharedUrl = assetUrls.get(thumbnail.assetId);

    if (!sharedUrl) {
      sharedUrl = {
        url: createObjectUrl(thumbnail.blob),
        references: 0
      };
      assetUrls.set(thumbnail.assetId, sharedUrl);
    }

    sharedUrl.references += 1;
    assignments.set(groupKey, { assetId: thumbnail.assetId, url: sharedUrl.url });
  }

  async function findGroupArtwork(group: AlbumArtworkGroup): Promise<CachedArtworkThumbnail | null> {
    for (const item of group.items) {
      const thumbnail = await loadThumbnail(item, ALBUM_ARTWORK_THUMBNAIL_SIZE);

      if (thumbnail) {
        return thumbnail;
      }
    }

    return null;
  }

  async function resolveGroups(token: number, groups: AlbumArtworkGroup[]): Promise<void> {
    let nextIndex = 0;

    async function worker(): Promise<void> {
      while (!destroyed && token === syncToken) {
        const group = groups[nextIndex];
        nextIndex += 1;

        if (!group) {
          return;
        }

        const signature = getGroupSignature(group);
        const thumbnail = await findGroupArtwork(group);

        if (destroyed || token !== syncToken || groupSignatures.get(group.key) !== signature) {
          continue;
        }

        resolvedGroups.add(group.key);

        if (thumbnail) {
          assign(group.key, thumbnail);
          emit();
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_LOADS, groups.length) }, () => worker())
    );
  }

  function sync(groups: AlbumArtworkGroup[]): void {
    if (destroyed) {
      return;
    }

    const nextSignatures = new Map(groups.map((group) => [group.key, getGroupSignature(group)]));
    const nextSyncSignature = Array.from(nextSignatures, ([key, signature]) => `${key}:${signature}`).join('\n');

    if (nextSyncSignature === activeSyncSignature) {
      return;
    }

    activeSyncSignature = nextSyncSignature;
    const pendingGroups = groups.filter((group) => {
      const signature = nextSignatures.get(group.key);
      return groupSignatures.get(group.key) !== signature || !resolvedGroups.has(group.key);
    });
    let changed = false;

    for (const key of groupSignatures.keys()) {
      if (!nextSignatures.has(key)) {
        releaseAssignment(key);
        resolvedGroups.delete(key);
        changed = true;
      }
    }

    for (const group of groups) {
      const signature = nextSignatures.get(group.key) ?? '';

      if (groupSignatures.get(group.key) !== signature) {
        releaseAssignment(group.key);
        resolvedGroups.delete(group.key);
        changed = true;
      }
    }

    groupSignatures.clear();
    for (const [key, signature] of nextSignatures) groupSignatures.set(key, signature);
    syncToken += 1;

    if (changed) {
      emit();
    }

    if (pendingGroups.length > 0) {
      void resolveGroups(syncToken, pendingGroups);
    }
  }

  return {
    subscribe(listener: (urls: AlbumArtworkUrls) => void) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    sync,
    destroy() {
      destroyed = true;
      syncToken += 1;
      for (const key of Array.from(assignments.keys())) releaseAssignment(key);
      groupSignatures.clear();
      resolvedGroups.clear();
      listeners.clear();
      snapshot = {};
    }
  };
}
