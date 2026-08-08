import { invalidateCachedArtwork } from '$lib/services/artwork-cache';
import { filesystemFolders } from '$lib/services/filesystem-folders';
import type { CurrentTrackExternalUpdate } from '$lib/services/player-controller';
import type { ExternalTrackUpdate } from '$lib/stores/playlist';
import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';
import {
  buildTroubadourBatchContext,
  detachTrackForMetadataWrite,
  readTroubadourBatchResult,
  readTroubadourWritePreparationRequest,
  respondToTroubadourBatchContextRequest,
  respondToTroubadourWritePreparation,
  REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE,
  type TroubadourBatchContext,
  type TroubadourBatchItemResult,
  type TroubadourTrackReference,
  type TroubadourWriteTarget
} from '$lib/services/troubadour-sync';

export interface TroubadourAppAdapterOptions {
  getState: () => {
    playingTrack: PlaylistItem | null;
    playlistItems: PlaylistItem[];
    libraryItems: PlaylistItem[];
    favoriteItems: PlaylistItem[];
    playlistSelectionIds: string[];
    librarySelectionIds: string[];
    favoriteSelectionIds: string[];
    playbackState: PlaybackSnapshot['state'];
    playbackCurrentTime: number;
  };
  player: {
    load: (
      track: PlaylistItem,
      options: { autoPlay: boolean; initialPosition: number }
    ) => Promise<void>;
    refreshCurrentTrack: (id: string, patch: CurrentTrackExternalUpdate) => boolean;
  };
  stores: {
    playlist: { applyExternalUpdate(id: string, patch: ExternalTrackUpdate): void };
    library: { applyExternalUpdate(id: string, patch: ExternalTrackUpdate): void };
    favorites: { applyExternalUpdate(id: string, patch: ExternalTrackUpdate): void };
  };
}

export interface TroubadourAppAdapter {
  handleWritePreparationRequest(event: MessageEvent, expectedSource: Window | null): boolean;
  handleBatchContextRequest(event: MessageEvent, expectedSource: Window | null): boolean;
  handleBatchResult(event: MessageEvent, expectedSource: Window | null): boolean;
}

export function createTroubadourAppAdapter(options: TroubadourAppAdapterOptions): TroubadourAppAdapter {
  let lastTroubadourContext: TroubadourBatchContext | null = null;

  function createTroubadourContext(): TroubadourBatchContext {
    const state = options.getState();
    const playlistIdSet = new Set(state.playlistSelectionIds);
    const libraryIdSet = new Set(state.librarySelectionIds);
    const favoriteIdSet = new Set(state.favoriteSelectionIds);

    return buildTroubadourBatchContext(
      [
        { collection: 'current', items: state.playingTrack ? [state.playingTrack] : [] },
        { collection: 'playlist', items: state.playlistItems.filter((item) => playlistIdSet.has(item.id)) },
        { collection: 'library', items: state.libraryItems.filter((item) => libraryIdSet.has(item.id)) },
        { collection: 'favorites', items: state.favoriteItems.filter((item) => favoriteIdSet.has(item.id)) }
      ],
      filesystemFolders.getSnapshot()
    );
  }

  type TroubadourMatchTarget = TroubadourBatchItemResult | TroubadourWriteTarget;

  function getTroubadourResultReferences(result: TroubadourMatchTarget): TroubadourTrackReference[] {
    const contextReferences = result.contextId
      ? lastTroubadourContext?.tracks.find((track) => track.contextId === result.contextId)?.references ?? []
      : [];
    const unique = new Map<string, TroubadourTrackReference>();

    for (const reference of [...(result.references ?? []), ...contextReferences]) {
      unique.set(`${reference.collection}:${reference.id}`, reference);
    }

    return [...unique.values()];
  }

  function getTroubadourContextTrack(result: TroubadourMatchTarget) {
    if (result.contextId) {
      const direct = lastTroubadourContext?.tracks.find((track) => track.contextId === result.contextId);
      if (direct) return direct;
    }

    const references = getTroubadourResultReferences(result);
    return lastTroubadourContext?.tracks.find((track) => track.references.some((candidate) =>
      references.some((reference) => (
        reference.collection === candidate.collection && reference.id === candidate.id
      ))
    ));
  }

  async function isTroubadourResultMatch(
    item: PlaylistItem,
    collection: TroubadourTrackReference['collection'],
    result: TroubadourMatchTarget
  ): Promise<boolean> {
    const references = getTroubadourResultReferences(result);

    if (references.some((reference) => reference.collection === collection && reference.id === item.id)) {
      return true;
    }

    const contextTrack = getTroubadourContextTrack(result);
    const originalPath = result.originalPath ?? contextTrack?.path;
    let pathMismatch = false;

    if (originalPath && item.path) {
      const normalize = (path: string) => path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
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

  async function preparePlaybackForTroubadourWrite(targets: TroubadourWriteTarget[]): Promise<void> {
    const state = options.getState();
    const track = state.playingTrack;
    if (!track) return;

    for (const target of targets) {
      if (!await isTroubadourResultMatch(track, 'current', target)) continue;
      await detachTrackForMetadataWrite(
        track,
        {
          autoPlay: state.playbackState === 'playing',
          initialPosition: state.playbackCurrentTime
        },
        (detachedTrack, detachOptions) => options.player.load(detachedTrack, detachOptions)
      );
      return;
    }
  }

  function getTroubadourExternalPatch(result: TroubadourBatchItemResult) {
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

  async function applyTroubadourResult(results: TroubadourBatchItemResult[]): Promise<void> {
    const state = options.getState();
    const successfulResults = results.filter((result) => result.success);
    const invalidatedTrackIds = new Set<string>();

    for (const result of successfulResults) {
      const patch = getTroubadourExternalPatch(result);
      const collections = [
        { name: 'playlist' as const, items: state.playlistItems, store: options.stores.playlist },
        { name: 'library' as const, items: state.libraryItems, store: options.stores.library },
        { name: 'favorites' as const, items: state.favoriteItems, store: options.stores.favorites }
      ];

      for (const collection of collections) {
        for (const item of collection.items) {
          if (await isTroubadourResultMatch(item, collection.name, result)) {
            collection.store.applyExternalUpdate(item.id, patch);
            invalidatedTrackIds.add(item.id);
          }
        }
      }

      if (state.playingTrack && await isTroubadourResultMatch(state.playingTrack, 'current', result)) {
        options.player.refreshCurrentTrack(state.playingTrack.id, patch);
        invalidatedTrackIds.add(state.playingTrack.id);
      }
    }

    await invalidateCachedArtwork(invalidatedTrackIds);
  }

  function handleWritePreparationRequest(event: MessageEvent, expectedSource: Window | null): boolean {
    const writePreparation = readTroubadourWritePreparationRequest(event, expectedSource);

    if (!writePreparation || !expectedSource) {
      return false;
    }

    void preparePlaybackForTroubadourWrite(writePreparation.targets)
      .finally(() => respondToTroubadourWritePreparation(expectedSource, writePreparation.requestId));
    return true;
  }

  function handleBatchContextRequest(event: MessageEvent, expectedSource: Window | null): boolean {
    if (event.data?.type !== REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE) {
      return false;
    }

    const context = createTroubadourContext();

    if (respondToTroubadourBatchContextRequest(event, expectedSource, context)) {
      lastTroubadourContext = context;
      return true;
    }

    return false;
  }

  function handleBatchResult(event: MessageEvent, expectedSource: Window | null): boolean {
    const troubadourResult = readTroubadourBatchResult(event, expectedSource);

    if (!troubadourResult) {
      return false;
    }

    void applyTroubadourResult(troubadourResult.results);
    return true;
  }

  return {
    handleWritePreparationRequest,
    handleBatchContextRequest,
    handleBatchResult
  };
}
