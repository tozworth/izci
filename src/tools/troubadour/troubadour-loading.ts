import { applyMetadataPatch } from '$lib/services/media-metadata/merge';
import { getMetadataCapabilities } from '$lib/services/media-metadata/format';
import { readMetadataDocument } from '$lib/services/media-metadata/reader';
import type { MediaMetadataFields } from '$lib/services/media-metadata/types';
import type { TroubadourRememberedFolder } from '$lib/services/troubadour-sync';
import { inferExtension, inferKind } from '$lib/utils/files';
import { autoGroupTracks } from './grouping';
import type { StagedWorkbenchState, TroubadourAutoGroupFallback, TroubadourWorkbenchItem } from './troubadour-controller';

export const LOAD_COMMIT_BATCH_SIZE = 64;
const LOAD_PROGRESS_INTERVAL_MS = 250;
export const LOAD_DEFAULT_CONCURRENCY = 3;

interface DiscoveredWorkbenchFile {
  fileHandle: FileSystemFileHandle;
  parentHandle: FileSystemDirectoryHandle | null;
  path: string;
}

export async function materializeWorkbenchFile(file: File): Promise<File> {
  return new File([await file.arrayBuffer()], file.name, {
    type: file.type,
    lastModified: file.lastModified
  });
}

async function resolveParentHandle(
  path: string | undefined,
  sourceFolderId: string | undefined,
  folders: TroubadourRememberedFolder[]
): Promise<FileSystemDirectoryHandle | null> {
  const root = sourceFolderId ? folders.find((folder) => folder.id === sourceFolderId) : undefined;
  if (!root || !path) return null;
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts[0]?.toLocaleLowerCase() === root.name.toLocaleLowerCase()) parts.shift();
  parts.pop();
  let directory = root.handle;
  try {
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    return directory;
  } catch {
    return null;
  }
}

export function metadataTrackForGrouping(item: TroubadourWorkbenchItem): {
  id: string;
  path: string;
  album?: string;
  albumArtist?: string;
  discNumber?: string;
  trackNumber?: string;
} {
  const fields = effectiveFields(item);
  return {
    id: item.id,
    path: item.path,
    album: fields?.album,
    albumArtist: fields?.albumArtist,
    discNumber: fields?.discNumber,
    trackNumber: fields?.trackNumber
  };
}

export function effectiveFields(item: TroubadourWorkbenchItem): MediaMetadataFields | null {
  return item.document ? applyMetadataPatch(item.document, item.patch, item.artworkEdits).fields : null;
}

interface TroubadourLoadingRunner {
  (job: (report: (activeJob: string, jobProgress?: number | null) => void) => Promise<TroubadourWorkbenchItem[]>): Promise<void>;
}

export function createTroubadourLoadingPipeline(options: {
  getState: () => { items: TroubadourWorkbenchItem[]; albums: StagedWorkbenchState['albums']; rememberedFolders: TroubadourRememberedFolder[] };
  getLoadGeneration: () => number;
  autoGroupFallback: TroubadourAutoGroupFallback | undefined;
  setJob: (activeJob: string, jobProgress?: number | null) => void;
  setTransientStaged: (staged: StagedWorkbenchState, statePatch?: Record<string, unknown>) => void;
  setMessage: (message: string) => void;
}): TroubadourLoadingRunner {
  const {
    getState,
    getLoadGeneration,
    autoGroupFallback,
    setJob,
    setTransientStaged,
    setMessage
  } = options;
  const generation = getLoadGeneration();

  return async function runLoadingJob(
    collectItems: (report: (activeJob: string, jobProgress?: number | null) => void) => Promise<TroubadourWorkbenchItem[]>
  ): Promise<void> {
    const items = await collectItems(setJob);
    if (getLoadGeneration() !== generation) return;
    await addLoadingItems(items, getState, getLoadGeneration, autoGroupFallback, setTransientStaged, setMessage);
  };
}

async function addLoadingItems(
  nextItems: TroubadourWorkbenchItem[],
  getState: () => { items: TroubadourWorkbenchItem[]; albums: StagedWorkbenchState['albums']; rememberedFolders: TroubadourRememberedFolder[] },
  getLoadGeneration: () => number,
  autoGroupFallback: TroubadourAutoGroupFallback | undefined,
  setTransientStaged: (staged: StagedWorkbenchState, statePatch?: Record<string, unknown>) => void,
  setMessage: (message: string) => void
): Promise<void> {
  const state = getState();
  const known = new Set(state.items.map((item) => `${item.path}\u0000${item.file.size}\u0000${item.file.lastModified}`));
  const unique = nextItems.filter((item) => {
    const key = `${item.path}\u0000${item.file.size}\u0000${item.file.lastModified}`;
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  if (!unique.length) {
    setMessage('No new files were found.');
    return;
  }
  const generation = getLoadGeneration();
  let workingItems = [...state.items, ...unique];
  let workingAlbums = state.albums;
  const applyAutomaticGrouping = () => {
    if (autoGroupFallback === undefined) return;
    const proposed = autoGroupTracks(workingItems.map(metadataTrackForGrouping), autoGroupFallback);
    const albumByItem = new Map(proposed.flatMap((album) => album.itemIds.map((itemId) => [itemId, album.id])));
    workingItems = workingItems.map((item) => ({ ...item, albumId: albumByItem.get(item.id) ?? null }));
    workingAlbums = proposed;
  };
  applyAutomaticGrouping();
  const positions = new Map(workingItems.map((item, itemIndex) => [item.id, itemIndex]));
  let index = 0;
  let completed = 0;
  let pendingUpdates = 0;
  let lastCommitAt = Date.now();
  const commitUpdates = (force = false) => {
    if (!pendingUpdates) return;
    const now = Date.now();
    if (!force && pendingUpdates < LOAD_COMMIT_BATCH_SIZE && now - lastCommitAt < LOAD_PROGRESS_INTERVAL_MS) {
      return;
    }
    pendingUpdates = 0;
    lastCommitAt = now;
    applyAutomaticGrouping();
    setTransientStaged({ items: [...workingItems], albums: workingAlbums }, {
      activeJob: `Reading metadata · ${completed} of ${unique.length} files`,
      jobProgress: completed / unique.length
    });
  };
  setTransientStaged({ items: [...workingItems], albums: workingAlbums }, {
    activeJob: `Reading metadata · 0 of ${unique.length} files`,
    jobProgress: 0
  });
  const workers = Array.from({ length: Math.min(Math.max(1, Math.trunc(LOAD_DEFAULT_CONCURRENCY)), unique.length) }, async () => {
    while (index < unique.length && generation === getLoadGeneration()) {
      const current = unique[index++];
      let replacement: TroubadourWorkbenchItem;
      if (!getMetadataCapabilities(current.extension)) {
        replacement = { ...current, state: 'unsupported' };
      } else {
        try {
          const document = await readMetadataDocument(current.file, current.extension);
          if (generation !== getLoadGeneration()) return;
          replacement = { ...current, document, state: 'ready', error: '' };
        } catch (error) {
          if (generation !== getLoadGeneration()) return;
          replacement = {
            ...current,
            state: 'unreadable',
            error: error instanceof Error ? error.message : 'Metadata could not be read.'
          };
        }
      }
      const position = positions.get(current.id);
      if (position !== undefined) workingItems[position] = replacement;
      completed += 1;
      pendingUpdates += 1;
      commitUpdates();
    }
  });
  await Promise.all(workers);
  if (generation !== getLoadGeneration()) return;
  commitUpdates(true);
  setMessage(`${unique.length} file${unique.length === 1 ? '' : 's'} loaded.`);
}

export async function itemFromHandle(
  handle: FileSystemFileHandle,
  path: string,
  parentHandle: FileSystemDirectoryHandle | null,
  base: Partial<TroubadourWorkbenchItem> = {}
): Promise<TroubadourWorkbenchItem> {
  const file = await handle.getFile();
  const extension = inferExtension(file.name);
  return {
    id: base.id ?? crypto.randomUUID(),
    contextId: base.contextId,
    references: base.references ?? [],
    file,
    fileHandle: handle,
    parentHandle,
    path,
    sourceFolderId: base.sourceFolderId,
    extension,
    kind: inferKind(extension) ?? 'stream',
    state: 'loading',
    document: null,
    patch: {},
    artworkEdits: [],
    albumId: null,
    error: '',
    jobProgress: null
  };
}

export async function itemsFromDiscoveredFiles(
  discovered: DiscoveredWorkbenchFile[],
  concurrency: number,
  report: (activeJob: string, jobProgress?: number | null) => void,
  label: string
): Promise<TroubadourWorkbenchItem[]> {
  const eligible = discovered.filter((entry) => getMetadataCapabilities(inferExtension(entry.fileHandle.name)));
  const items = new Array<TroubadourWorkbenchItem | undefined>(eligible.length);
  let index = 0;
  let completed = 0;
  let lastReported = 0;
  const workerCount = Math.min(Math.max(1, Math.trunc(concurrency)), eligible.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < eligible.length) {
      const currentIndex = index++;
      const current = eligible[currentIndex];
      try {
        items[currentIndex] = await itemFromHandle(
          current.fileHandle,
          current.path,
          current.parentHandle
        );
      } finally {
        completed += 1;
        if (completed === eligible.length || completed - lastReported >= LOAD_COMMIT_BATCH_SIZE) {
          lastReported = completed;
          report(`Opening ${label} · ${completed} of ${eligible.length} files`, completed / eligible.length);
        }
      }
    }
  });
  await Promise.all(workers);
  return items.filter((item): item is TroubadourWorkbenchItem => item !== undefined);
}

export async function itemsFromBatchTracks(
  tracks: import('$lib/services/troubadour-sync').TroubadourBatchTrack[],
  concurrency: number,
  report: (activeJob: string, jobProgress?: number | null) => void,
  folders: TroubadourRememberedFolder[]
): Promise<TroubadourWorkbenchItem[]> {
  const eligible = tracks.filter((track) => getMetadataCapabilities(track.extension));
  const items = new Array<TroubadourWorkbenchItem | undefined>(eligible.length);
  let index = 0;
  let completed = 0;
  let lastReported = 0;
  const workers = Array.from({
    length: Math.min(Math.max(1, Math.trunc(concurrency)), eligible.length)
  }, async () => {
    while (index < eligible.length) {
      const currentIndex = index++;
      const track = eligible[currentIndex];
      try {
        const sourceFile = track.fileHandle ? await track.fileHandle.getFile() : track.file;
        if (!sourceFile) continue;
        const parentHandle = await resolveParentHandle(track.path, track.sourceFolderId, folders);
        items[currentIndex] = {
          id: track.contextId || crypto.randomUUID(),
          contextId: track.contextId,
          references: track.references,
          file: sourceFile,
          fileHandle: track.fileHandle ?? null,
          parentHandle,
          path: track.path || sourceFile.name,
          sourceFolderId: track.sourceFolderId,
          extension: track.extension || inferExtension(sourceFile.name),
          kind: track.kind,
          state: 'loading',
          document: null,
          patch: {},
          artworkEdits: [],
          albumId: null,
          error: '',
          jobProgress: null
        };
      } catch {
        // Stale handles are represented only when a File snapshot is available.
      } finally {
        completed += 1;
        if (completed === eligible.length || completed - lastReported >= LOAD_COMMIT_BATCH_SIZE) {
          lastReported = completed;
          report(`Opening izci files · ${completed} of ${eligible.length}`, completed / eligible.length);
        }
      }
    }
  });
  await Promise.all(workers);
  return items.filter((item): item is TroubadourWorkbenchItem => item !== undefined);
}
