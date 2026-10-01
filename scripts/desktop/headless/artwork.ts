import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import type { TrackItem } from '../../../src/lib/types';
import { loadEmbeddedStreamArtwork } from '../../../src/lib/services/stream-artwork';
import { getCachedArtworkThumbnail } from '../../../src/lib/services/artwork-cache';
import { createArtworkPresentationController } from '../../../src/lib/services/artwork-presentation';
import { materializePlatformFile } from '../../../src/desktop/files';

interface ArtworkResult {
  name: string;
  artwork?: boolean;
  thumbnail?: boolean;
  details?: boolean;
  independentArtworkCount?: number | null;
  error?: string;
}

async function items(database: string): Promise<TrackItem[]> {
  const databases = await indexedDB.databases();
  if (!databases.some((entry) => entry.name === database)) return [];
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(database);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('queue', 'readonly');
      const get = tx.objectStore('queue').get('state');
      get.onsuccess = () => resolve(get.result?.items || []);
      get.onerror = () => reject(get.error);
      tx.oncomplete = tx.onabort = () => db.close();
    };
  });
}

export async function run() {
  const library = await items('izci-library');
  const queue = await items('izci-queue');
  const candidates = [...queue, ...library].filter((track) =>
    track.kind === 'stream' && ['opus', 'flac'].includes(track.extension));
  const unique = [...new Map(candidates.map((track) => [track.path || track.id, track])).values()];
  const results: ArtworkResult[] = [];
  for (const track of unique) {
    let controller: ReturnType<typeof createArtworkPresentationController> | undefined;
    try {
      const embedded = await loadEmbeddedStreamArtwork(track);
      let independentArtworkCount: number | null = null;
      if (!embedded) {
        const file = track.fileHandle ? await track.fileHandle.getFile()
          : track.desktopFile && track.path ? await materializePlatformFile(track.path) : null;
        if (!file) throw new Error('Source file unavailable');
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        try { independentArtworkCount = (await input.getMetadataTags()).images?.length || 0; }
        finally { input.dispose(); }
      }
      const thumbnail = await getCachedArtworkThumbnail(track);
      controller = createArtworkPresentationController({ resolveTrackSnapshot: (value) => value, isPlaybackDetailsPending: () => false });
      controller.syncSelection(track, true);
      await controller.syncDetailsDisplay();
      results.push({ name: track.name, artwork: Boolean(embedded), thumbnail: Boolean(thumbnail),
        details: Boolean(controller.getSnapshot().visibleDetailsArtwork), independentArtworkCount });
    } catch (error) { results.push({ name: track.name, error: String(error) }); }
    finally { controller?.destroy(); }
  }
  return { summary: { checked: results.length, artwork: results.filter((result) => result.artwork).length,
    missing: results.filter((result) => result.independentArtworkCount === 0).length,
    failures: results.filter((result) => result.error || (result.artwork && (!result.thumbnail || !result.details))
      || (result.independentArtworkCount || 0) > 0).length }, results };
}
