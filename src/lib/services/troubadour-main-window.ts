import { invalidateCachedArtwork } from '$lib/services/artwork-cache';
import { filesystemFolders } from '$lib/services/filesystem-folders';
import { favoritesStore, libraryStore, queueStore } from '$lib/stores/queue';
import type { ExternalTrackUpdate } from '$lib/stores/queue';
import { respondToToolTrackRequest } from '$lib/services/tool-track-context';
import {
  buildTroubadourBatchContext,
  detachTrackForMetadataWrite,
  readTroubadourBatchResult,
  readTroubadourWritePreparationRequest,
  REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE,
  respondToTroubadourBatchContextRequest,
  respondToTroubadourWritePreparation,
  type TroubadourBatchContext,
  type TroubadourBatchItemResult,
  type TroubadourTrackReference,
  type TroubadourWriteTarget
} from '$lib/services/troubadour-sync';
import { isOptionsViewName, type OptionsViewName } from '../../options/views';
import type { TrackLibraryNavigationTarget } from '$lib/services/library-navigation';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';

export interface TroubadourMainWindowDeps {
  getPlayingTrack(): TrackItem | null;
  getQueueItems(): TrackItem[];
  getLibraryItems(): TrackItem[];
  getFavoriteItems(): TrackItem[];
  getQueueSelectionIds(): string[];
  getLibrarySelectionIds(): string[];
  getFavoriteSelectionIds(): string[];
  getPlaybackStatus(): Pick<PlaybackSnapshot, 'state'>;
  getPlaybackSnapshot(): PlaybackSnapshot;
  loadTrack(
    track: TrackItem,
    options: { autoPlay: boolean; initialPosition: number }
  ): Promise<void>;
  refreshCurrentTrack(id: string, patch: ExternalTrackUpdate): void;
  getTroubadourWindow(): Window | null;
  showLibraryGroup(target: TrackLibraryNavigationTarget): void;
  openOptions(view?: OptionsViewName): void;
}

type TroubadourMatchTarget = TroubadourBatchItemResult | TroubadourWriteTarget;

/**
 * Troubadour bridge for the main window: builds the batch context from the
 * current selections, matches batch results back to local tracks, applies
 * external updates to the collections, and handles popup-window messages
 * (tool track requests, write preparation, batch context requests, results,
 * open-options). The popup's own logic lives in troubadour-sync.ts.
 */
export function createTroubadourMainWindowBridge(deps: TroubadourMainWindowDeps) {
  let lastContext: TroubadourBatchContext | null = null;

  function createContext(): TroubadourBatchContext {
    const queueIdSet = new Set(deps.getQueueSelectionIds());
    const libraryIdSet = new Set(deps.getLibrarySelectionIds());
    const favoriteIdSet = new Set(deps.getFavoriteSelectionIds());

    return buildTroubadourBatchContext(
      [
        { collection: 'current', items: deps.getPlayingTrack() ? [deps.getPlayingTrack()!] : [] },
        { collection: 'queue', items: deps.getQueueItems().filter((item) => queueIdSet.has(item.id)) },
        { collection: 'library', items: deps.getLibraryItems().filter((item) => libraryIdSet.has(item.id)) },
        { collection: 'favorites', items: deps.getFavoriteItems().filter((item) => favoriteIdSet.has(item.id)) }
      ],
      filesystemFolders.getSnapshot()
    );
  }

  function getResultReferences(result: TroubadourMatchTarget): TroubadourTrackReference[] {
    const contextReferences = result.contextId
      ? lastContext?.tracks.find((track) => track.contextId === result.contextId)?.references ?? []
      : [];
    const unique = new Map<string, TroubadourTrackReference>();

    for (const reference of [...(result.references ?? []), ...contextReferences]) {
      unique.set(`${reference.collection}:${reference.id}`, reference);
    }

    return [...unique.values()];
  }

  function getContextTrack(result: TroubadourMatchTarget) {
    if (result.contextId) {
      const direct = lastContext?.tracks.find((track) => track.contextId === result.contextId);
      if (direct) return direct;
    }

    const references = getResultReferences(result);
    return lastContext?.tracks.find((track) => track.references.some((candidate) =>
      references.some((reference) => (
        reference.collection === candidate.collection && reference.id === candidate.id
      ))
    ));
  }

  async function isResultMatch(
    item: TrackItem,
    collection: TroubadourTrackReference['collection'],
    result: TroubadourMatchTarget
  ): Promise<boolean> {
    const references = getResultReferences(result);

    if (references.some((reference) => reference.collection === collection && reference.id === item.id)) {
      return true;
    }

    const contextTrack = getContextTrack(result);
    const originalPath = result.originalPath ?? contextTrack?.path;
    let pathMismatch = false;

    if (originalPath && item.path) {
      const normalize = (path: string) => path.replace(/\\\\/g, '/').replace(/^\/+/, '').toLowerCase();
      if (normalize(originalPath) === normalize(item.path)) return true;
      pathMismatch = true;
    }

    const originalHandle = result.originalFileHandle ?? contextTrack?.fileHandle;

    if (originalHandle && item.fileHandle) {
      if (originalHandle === item.fileHandle) return true;

      try {
        if (typeof originalHandle.isSameEntry === 'function' && await originalHandle.isSameEntry(item.fileHandle)) {
          return true;
        }
      } catch {
        // Stale handles can still be matched by the immutable source fingerprint below.
      }
    }

    if (pathMismatch) return false;

    const originalName = result.originalName ?? contextTrack?.name;
    const originalSize = result.originalSize ?? contextTrack?.size;
    const originalLastModified = result.originalLastModified ?? contextTrack?.lastModified;
    return Boolean(
      originalName
      && originalSize !== undefined
      && originalLastModified !== undefined
      && item.name.toLowerCase() === originalName.toLowerCase()
      && item.size === originalSize
      && item.lastModified === originalLastModified
    );
  }

  async function preparePlaybackForWrite(targets: TroubadourWriteTarget[]): Promise<void> {
    const track = deps.getPlayingTrack();
    if (!track) return;

    for (const target of targets) {
      if (!await isResultMatch(track, 'current', target)) continue;
      await detachTrackForMetadataWrite(
        track,
        {
          autoPlay: deps.getPlaybackStatus().state === 'playing',
          initialPosition: deps.getPlaybackSnapshot().currentTime
        },
        (detachedTrack, options) => deps.loadTrack(detachedTrack, options)
      );
      return;
    }
  }

  function getExternalPatch(result: TroubadourBatchItemResult): ExternalTrackUpdate {
    return {
      ...(result.file ? { file: result.file } : {}),
      ...(result.fileHandle ? { fileHandle: result.fileHandle } : {}),
      ...(result.path !== undefined ? { path: result.path } : {}),
      ...(result.sourceFolderId !== undefined ? { sourceFolderId: result.sourceFolderId } : {}),
      ...(result.name !== undefined ? { name: result.name } : {}),
      ...(result.extension !== undefined ? { extension: result.extension } : {}),
      ...(result.kind !== undefined ? { kind: result.kind } : {}),
      ...(result.size !== undefined ? { size: result.size } : {}),
      ...(result.lastModified !== undefined ? { lastModified: result.lastModified } : {}),
      ...(result.metadata !== undefined ? { metadata: result.metadata } : {})
    };
  }

  async function applyResult(results: TroubadourBatchItemResult[]): Promise<void> {
    const successfulResults = results.filter((result) => result.success);
    const invalidatedTrackIds = new Set<string>();

    for (const result of successfulResults) {
      const patch = getExternalPatch(result);
      const collections = [
        { name: 'queue' as const, items: deps.getQueueItems(), store: queueStore },
        { name: 'library' as const, items: deps.getLibraryItems(), store: libraryStore },
        { name: 'favorites' as const, items: deps.getFavoriteItems(), store: favoritesStore }
      ];

      for (const collection of collections) {
        for (const item of collection.items) {
          if (await isResultMatch(item, collection.name, result)) {
            collection.store.applyExternalUpdate(item.id, patch);
            invalidatedTrackIds.add(item.id);
          }
        }
      }

      const playingTrack = deps.getPlayingTrack();
      if (playingTrack && await isResultMatch(playingTrack, 'current', result)) {
        deps.refreshCurrentTrack(playingTrack.id, patch);
        invalidatedTrackIds.add(playingTrack.id);
      }
    }

    await invalidateCachedArtwork(invalidatedTrackIds);
  }

  function handleMessage(event: MessageEvent): void {
    if (respondToToolTrackRequest(event, deps.getPlayingTrack())) {
      return;
    }

    const troubadourWindow = deps.getTroubadourWindow();

    const writePreparation = readTroubadourWritePreparationRequest(event, troubadourWindow);
    if (writePreparation && troubadourWindow) {
      void preparePlaybackForWrite(writePreparation.targets)
        .finally(() => respondToTroubadourWritePreparation(troubadourWindow, writePreparation.requestId));
      return;
    }

    if (event.data?.type === REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE) {
      const context = createContext();

      if (respondToTroubadourBatchContextRequest(event, troubadourWindow, context)) {
        lastContext = context;
        return;
      }
    }

    const troubadourResult = readTroubadourBatchResult(event, troubadourWindow);

    if (troubadourResult) {
      void applyResult(troubadourResult.results);
      return;
    }

    if (event.origin !== window.location.origin || event.data?.type !== 'izci:open-options') {
      return;
    }

    const view = isOptionsViewName(event.data.view) ? event.data.view : undefined;
    deps.openOptions(view);
  }

  return {
    handleMessage
  };
}
