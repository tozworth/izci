import { writable } from 'svelte/store';
import { isSameArtworkFile } from '$lib/services/media-metadata/artwork';
import { applyMetadataPatch } from '$lib/services/media-metadata/merge';
import { getMetadataCapabilities } from '$lib/services/media-metadata/format';
import { readMetadataDocument } from '$lib/services/media-metadata/reader';
import type {
  ArtworkEdit,
  MediaArtworkInput,
  MediaMetadataFieldName,
  MetadataDocument,
  MetadataPatch
} from '$lib/services/media-metadata/types';
import type {
  TroubadourBatchTrack,
  TroubadourRememberedFolder,
  TroubadourTrackReference
} from '$lib/services/troubadour-sync';
import { discoverDirectoryFiles, inferExtension } from '$lib/utils/files';
import { autoGroupTracks, renumberAlbumTracks } from './grouping';
import { createHistory, pushHistory, undoHistory, redoHistory, type HistoryState } from './history';
import { cloneStaged, itemDirty } from './troubadour-staged';
import {
  createTroubadourLoadingPipeline,
  LOAD_COMMIT_BATCH_SIZE,
  LOAD_DEFAULT_CONCURRENCY,
  itemFromHandle,
  itemsFromBatchTracks,
  itemsFromDiscoveredFiles,
  materializeWorkbenchFile,
  metadataTrackForGrouping,
  effectiveFields,
  inferWorkbenchKind
} from './troubadour-loading';
import { createTroubadourRenamePipeline } from './troubadour-rename';
import {
  createTroubadourSavePipeline,
  defaultSaveHandler,
  itemState
} from './troubadour-save';

export type WorkbenchItemState =
  | 'loading'
  | 'ready'
  | 'unsupported'
  | 'unreadable'
  | 'dirty'
  | 'permission-required'
  | 'saving'
  | 'saved'
  | 'failed'
  | 'conflicted';

export interface TroubadourWorkbenchItem {
  id: string;
  contextId?: string;
  references: TroubadourTrackReference[];
  file: File;
  fileHandle: FileSystemFileHandle | null;
  parentHandle: FileSystemDirectoryHandle | null;
  path: string;
  sourceFolderId?: string;
  extension: string;
  kind: 'stream' | 'module' | 'video';
  state: WorkbenchItemState;
  document: MetadataDocument | null;
  patch: MetadataPatch;
  artworkEdits: ArtworkEdit[];
  albumId: string | null;
  error: string;
  jobProgress: number | null;
}

export interface TroubadourAlbum {
  id: string;
  title: string;
  albumArtist: string;
  itemIds: string[];
}

export interface StagedWorkbenchState {
  items: TroubadourWorkbenchItem[];
  albums: TroubadourAlbum[];
}

export interface TroubadourWorkbenchState extends StagedWorkbenchState {
  selectedIds: string[];
  selectedAlbumId: string | null;
  selectionAnchorId: string | null;
  rememberedFolders: TroubadourRememberedFolder[];
  busy: boolean;
  message: string;
  error: string;
  canUndo: boolean;
  canRedo: boolean;
  activeJob: string;
  jobProgress: number | null;
}

interface SaveWorkbenchItem {
  item: TroubadourWorkbenchItem;
  requestPermission: boolean;
  signal?: AbortSignal;
  verify?: boolean;
  fullVerification?: boolean;
}

interface SaveWorkbenchResult {
  document: MetadataDocument;
  verified: boolean;
}

export type SaveWorkbenchItemHandler = (request: SaveWorkbenchItem) => Promise<SaveWorkbenchResult>;

const EMPTY_STATE: TroubadourWorkbenchState = {
  items: [],
  albums: [],
  selectedIds: [],
  selectedAlbumId: null,
  selectionAnchorId: null,
  rememberedFolders: [],
  busy: false,
  message: '',
  error: '',
  canUndo: false,
  canRedo: false,
  activeJob: '',
  jobProgress: null
};

export type TroubadourAutoGroupFallback = 'folder' | 'none';

export function selectedFieldValue(
  items: TroubadourWorkbenchItem[],
  selectedIds: string[],
  field: MediaMetadataFieldName
): { value: string; varies: boolean; original: string; originalVaries: boolean } {
  const selected = items.filter((item) => selectedIds.includes(item.id) && item.document);
  const values = selected.map((item) => effectiveFields(item)![field]);
  const originals = selected.map((item) => item.document!.fields[field]);
  return {
    value: values[0] ?? '',
    varies: new Set(values).size > 1,
    original: originals[0] ?? '',
    originalVaries: new Set(originals).size > 1
  };
}

export function createTroubadourController(
  saveItem: SaveWorkbenchItemHandler = defaultSaveHandler()
) {
  const store = writable<TroubadourWorkbenchState>(EMPTY_STATE);
  let state = EMPTY_STATE;
  let history: HistoryState<StagedWorkbenchState> = createHistory({ items: [], albums: [] });
  let loadGeneration = 0;
  let batchAbort: AbortController | null = null;
  store.subscribe((value) => (state = value));

  const setState = (patch: Partial<TroubadourWorkbenchState>) => store.set({ ...state, ...patch });
  const setStaged = (
    staged: StagedWorkbenchState,
    record = true,
    statePatch: Partial<TroubadourWorkbenchState> = {}
  ) => {
    const next = cloneStaged(staged);
    history = record ? pushHistory(history, next) : { ...history, present: next };
    store.set({
      ...state,
      ...next,
      ...statePatch,
      canUndo: history.undo.length > 0,
      canRedo: history.redo.length > 0
    });
  };
  const setTransientStaged = (
    staged: StagedWorkbenchState,
    statePatch: Partial<TroubadourWorkbenchState> = {}
  ) => {
    history = { ...history, present: staged };
    store.set({
      ...state,
      ...staged,
      ...statePatch,
      canUndo: history.undo.length > 0,
      canRedo: history.redo.length > 0
    });
  };
  const setBusyComplete = (message: string) => {
    batchAbort = null;
    setState({ busy: false, activeJob: '', jobProgress: null, canUndo: false, canRedo: false, message });
  };
  const setJob = (activeJob: string, jobProgress?: number | null) => {
    setState({ activeJob, jobProgress: jobProgress ?? null });
  };
  const setMessage = (message: string) => setState({ message });

  /** Begins a cancellable batch: one shared signal for the whole save/rename run. */
  const beginBatch = (): AbortSignal => {
    batchAbort?.abort();
    const controller = new AbortController();
    batchAbort = controller;
    return controller.signal;
  };

  /** Aborts the running batch or metadata-read load; safe to call when idle. */
  const cancelActiveJob = (): boolean => {
    let cancelled = false;
    if (batchAbort && !batchAbort.signal.aborted) {
      batchAbort.abort();
      cancelled = true;
    }
    if (state.busy && !batchAbort) {
      loadGeneration += 1;
      cancelled = true;
    }
    return cancelled;
  };

  const savePipeline = createTroubadourSavePipeline({
    state: () => state,
    setHistory: (next) => { history = next; },
    setJob,
    setStaged,
    setState,
    setBusyComplete,
    saveItem,
    beginBatch
  });

  const renamePipeline = createTroubadourRenamePipeline({
    state: () => state,
    setHistory: (next) => { history = next; },
    setJob,
    setStaged,
    setState,
    setBusyComplete,
    saveSelectedOrAll: (options) => savePipeline.saveSelectedOrAll(options),
    beginBatch
  });

  const assignItemsToAlbum = (itemIds: string[], id: string) => {
    const target = state.albums.find((album) => album.id === id);
    const assigned = new Set(itemIds.filter((itemId) => state.items.some((item) => item.id === itemId)));
    if (!target || !assigned.size) return;
    setStaged({
      items: state.items.map((item) => assigned.has(item.id) ? { ...item, albumId: id } : item),
      albums: state.albums.map((album) => ({
        ...album,
        itemIds: album.id === id
          ? [...new Set([...album.itemIds, ...assigned])]
          : album.itemIds.filter((itemId) => !assigned.has(itemId))
      })).filter((album) => album.itemIds.length > 0)
    });
    setState({ selectedAlbumId: null });
  };

  const api = {
    subscribe: store.subscribe,
    getSnapshot: () => state,
    setRememberedFolders(folders: TroubadourRememberedFolder[]) {
      setState({ rememberedFolders: folders });
    },
    async ingestBatchTracks(
      tracks: TroubadourBatchTrack[],
      concurrency = LOAD_DEFAULT_CONCURRENCY,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ) {
      loadGeneration += 1;
      setState({ busy: true, activeJob: 'Opening izci files', jobProgress: null, error: '' });
      try {
        const run = createTroubadourLoadingPipeline({
          getState: () => state,
          getLoadGeneration: () => loadGeneration,
          autoGroupFallback,
          setJob,
          setTransientStaged,
          setMessage
        });
        await run(async (report) => {
          return await itemsFromBatchTracks(tracks, concurrency, report, state.rememberedFolders);
        });
      } finally {
        setState({ busy: false, activeJob: '', jobProgress: null });
      }
    },
    async ingestHandles(
      handles: FileSystemFileHandle[],
      concurrency = LOAD_DEFAULT_CONCURRENCY,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ) {
      loadGeneration += 1;
      setState({ busy: true, activeJob: 'Opening files', jobProgress: null, error: '' });
      try {
        const run = createTroubadourLoadingPipeline({
          getState: () => state,
          getLoadGeneration: () => loadGeneration,
          autoGroupFallback,
          setJob,
          setTransientStaged,
          setMessage
        });
        await run(async (report) => {
          return await itemsFromDiscoveredFiles(
            handles.map((fileHandle) => ({ fileHandle, path: fileHandle.name, parentHandle: null })),
            concurrency,
            report,
            'files'
          );
        });
      } finally {
        setState({ busy: false, activeJob: '', jobProgress: null });
      }
    },
    async ingestDirectory(
      handle: FileSystemDirectoryHandle,
      maxDepth = Number.POSITIVE_INFINITY,
      concurrency = LOAD_DEFAULT_CONCURRENCY,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ) {
      loadGeneration += 1;
      setState({ busy: true, activeJob: `Scanning ${handle.name} · 0 files found`, jobProgress: null, error: '' });
      try {
        const run = createTroubadourLoadingPipeline({
          getState: () => state,
          getLoadGeneration: () => loadGeneration,
          autoGroupFallback,
          setJob,
          setTransientStaged,
          setMessage
        });
        await run(async (report) => {
          let found = 0;
          let lastReported = 0;
          const discovered = await discoverDirectoryFiles(handle, {
            maxDepth,
            onFileFound: () => {
              found += 1;
              if (found - lastReported >= LOAD_COMMIT_BATCH_SIZE) {
                lastReported = found;
                report(`Scanning ${handle.name} · ${found} files found`);
              }
            }
          });
          report(`Scanning ${handle.name} · ${found} file${found === 1 ? '' : 's'} found`);
          return await itemsFromDiscoveredFiles(discovered, concurrency, report, handle.name);
        });
      } finally {
        setState({ busy: false, activeJob: '', jobProgress: null });
      }
    },
    async ingestDropped(
      dataTransfer: DataTransfer,
      maxDepth = Number.POSITIVE_INFINITY,
      concurrency = LOAD_DEFAULT_CONCURRENCY,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ) {
      loadGeneration += 1;
      setState({ busy: true, activeJob: 'Scanning dropped items · 0 files found', jobProgress: null, error: '' });
      try {
        const run = createTroubadourLoadingPipeline({
          getState: () => state,
          getLoadGeneration: () => loadGeneration,
          autoGroupFallback,
          setJob,
          setTransientStaged,
          setMessage
        });
        await run(async (report) => {
          const items: TroubadourWorkbenchItem[] = [];
          let found = 0;
          let lastReported = 0;
          const reportFound = () => {
            found += 1;
            if (found - lastReported >= LOAD_COMMIT_BATCH_SIZE) {
              lastReported = found;
              report(`Scanning dropped items · ${found} files found`);
            }
          };
          for (const transferItem of Array.from(dataTransfer.items)) {
            const handle = await transferItem.getAsFileSystemHandle?.().catch(() => null);
            if (handle?.kind === 'file') {
              const fileHandle = handle as FileSystemFileHandle;
              if (getMetadataCapabilities(inferExtension(fileHandle.name))) {
                reportFound();
                items.push(await itemFromHandle(fileHandle, fileHandle.name, null));
              }
            } else if (handle?.kind === 'directory') {
              const directory = handle as FileSystemDirectoryHandle;
              const discovered = await discoverDirectoryFiles(directory, { maxDepth, onFileFound: reportFound });
              items.push(...await itemsFromDiscoveredFiles(discovered, concurrency, report, 'dropped files'));
            }
          }
          if (!items.length) {
            for (const file of Array.from(dataTransfer.files)) {
              if (!getMetadataCapabilities(inferExtension(file.name))) continue;
              reportFound();
              const extension = inferExtension(file.name);
              items.push({
                id: crypto.randomUUID(), references: [], file, fileHandle: null, parentHandle: null,
                path: file.webkitRelativePath || file.name, extension, kind: inferWorkbenchKind(extension), state: 'loading',
                document: null, patch: {}, artworkEdits: [], albumId: null, error: '', jobProgress: null
              });
            }
          }
          report(`Scanning dropped items · ${found} file${found === 1 ? '' : 's'} found`);
          return items;
        });
      } finally {
        setState({ busy: false, activeJob: '', jobProgress: null });
      }
    },
    select(id: string, options: { additive?: boolean; range?: boolean } = {}) {
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) return;
      let selectedIds: string[];
      if (options.range && state.selectionAnchorId) {
        const anchor = state.items.findIndex((item) => item.id === state.selectionAnchorId);
        const rangeIds = state.items.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((item) => item.id);
        selectedIds = options.additive ? [...new Set([...state.selectedIds, ...rangeIds])] : rangeIds;
      } else if (options.additive) {
        selectedIds = state.selectedIds.includes(id)
          ? state.selectedIds.filter((candidate) => candidate !== id)
          : [...state.selectedIds, id];
      } else {
        selectedIds = [id];
      }
      setState({ selectedIds, selectedAlbumId: null, selectionAnchorId: options.range ? state.selectionAnchorId : id });
    },
    selectAlbum(id: string) {
      const album = state.albums.find((candidate) => candidate.id === id);
      if (album) setState({ selectedAlbumId: id, selectedIds: [...album.itemIds], selectionAnchorId: album.itemIds[0] ?? null });
    },
    selectAll() {
      setState({ selectedIds: state.items.map((item) => item.id), selectionAnchorId: state.items[0]?.id ?? null });
    },
    clearSelection() {
      setState({ selectedIds: [], selectedAlbumId: null, selectionAnchorId: null });
    },
    removeSelected() {
      const removed = new Set(state.selectedIds);
      setStaged({
        items: state.items.filter((item) => !removed.has(item.id)),
        albums: state.albums
          .map((album) => ({ ...album, itemIds: album.itemIds.filter((id) => !removed.has(id)) }))
          .filter((album) => album.itemIds.length > 0)
      });
      setState({ selectedIds: [], selectedAlbumId: null, selectionAnchorId: null });
    },
    editField(field: MediaMetadataFieldName, value: string | null) {
      const selected = new Set(state.selectedIds);
      setStaged({
        items: state.items.map((item) => selected.has(item.id) && item.document
          ? { ...item, patch: { ...item.patch, [field]: value }, state: 'dirty', error: '' }
          : item),
        albums: state.albums
      });
    },
    editItemField(id: string, field: MediaMetadataFieldName, value: string | null) {
      setStaged({
        items: state.items.map((item) => item.id === id && item.document
          ? { ...item, patch: { ...item.patch, [field]: value }, state: 'dirty', error: '' }
          : item),
        albums: state.albums
      });
    },
    resetField(field: MediaMetadataFieldName) {
      const selected = new Set(state.selectedIds);
      setStaged({
        items: state.items.map((item) => {
          if (!selected.has(item.id)) return item;
          const patch = { ...item.patch };
          delete patch[field];
          return { ...item, patch, state: itemState({ ...item, patch }) };
        }),
        albums: state.albums
      });
    },
    addArtwork(artwork: MediaArtworkInput, behavior: 'preserve' | 'replace-kind' | 'reject' = 'preserve') {
      const selected = new Set(state.selectedIds);
      setStaged({
        items: state.items.map((item) => {
          if (!selected.has(item.id) || !item.document) return item;
          const current = applyMetadataPatch(item.document, item.patch, item.artworkEdits).artwork;
          if (current.some((candidate) => isSameArtworkFile(candidate, artwork))) return item;
          if (behavior === 'reject' && current.length) return item;
          const sameKind = behavior === 'replace-kind'
            ? current.find((candidate) => candidate.kind === artwork.kind)
            : undefined;
          const edit: ArtworkEdit = sameKind
            ? { type: 'replace', targetId: sameKind.id, artwork }
            : { type: 'add', artwork };
          return { ...item, artworkEdits: [...item.artworkEdits, edit], state: 'dirty' };
        }),
        albums: state.albums
      });
    },
    replaceArtwork(artworkId: string, artwork: MediaArtworkInput) {
      const selected = new Set(state.selectedIds);
      setStaged({
        items: state.items.map((item) => selected.has(item.id) && item.document
          ? { ...item, artworkEdits: [...item.artworkEdits, { type: 'replace', targetId: artworkId, artwork }], state: 'dirty' }
          : item),
        albums: state.albums
      });
    },
    removeArtwork(artworkId: string) {
      const selected = new Set(state.selectedIds);
      setStaged({
        items: state.items.map((item) => selected.has(item.id) && item.document
          ? { ...item, artworkEdits: [...item.artworkEdits, { type: 'remove', targetId: artworkId }], state: 'dirty' }
          : item),
        albums: state.albums
      });
    },
    clearArtwork() {
      const selected = new Set(state.selectedIds);
      setStaged({
        items: state.items.map((item) => selected.has(item.id) && item.document
          ? { ...item, artworkEdits: [...item.artworkEdits, { type: 'clear' }], state: 'dirty' }
          : item),
        albums: state.albums
      });
    },
    applyArtworkToAlbum(albumId: string, artwork: MediaArtworkInput, behavior: 'preserve' | 'replace-kind' | 'reject' = 'preserve') {
      const album = state.albums.find((candidate) => candidate.id === albumId);
      if (!album) return;
      const albumItems = new Set(album.itemIds);
      setStaged({
        items: state.items.map((item) => {
          if (!albumItems.has(item.id) || !item.document) return item;
          const current = applyMetadataPatch(item.document, item.patch, item.artworkEdits).artwork;
          if (current.some((candidate) => isSameArtworkFile(candidate, artwork))) return item;
          if (behavior === 'reject' && current.length) return item;
          const sameKind = behavior === 'replace-kind'
            ? current.find((candidate) => candidate.kind === artwork.kind)
            : undefined;
          const edit: ArtworkEdit = sameKind
            ? { type: 'replace', targetId: sameKind.id, artwork }
            : { type: 'add', artwork };
          return { ...item, artworkEdits: [...item.artworkEdits, edit], state: 'dirty' };
        }),
        albums: state.albums
      });
    },
    undo() {
      history = undoHistory(history);
      setStaged(history.present, false);
      setState({ canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 });
    },
    redo() {
      history = redoHistory(history);
      setStaged(history.present, false);
      setState({ canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 });
    },
    createAlbum(title = 'New album') {
      const itemIds = [...state.selectedIds];
      if (!itemIds.length) return null;
      const id = crypto.randomUUID();
      setStaged({
        items: state.items.map((item) => itemIds.includes(item.id) ? { ...item, albumId: id } : item),
        albums: [...state.albums, { id, title, albumArtist: '', itemIds }]
      });
      setState({ selectedAlbumId: id });
      return id;
    },
    autoGroup(fallback: 'folder' | 'none' = 'folder') {
      const proposed = autoGroupTracks(state.items.map(metadataTrackForGrouping), fallback);
      const albumByItem = new Map(proposed.flatMap((album) => album.itemIds.map((itemId) => [itemId, album.id])));
      setStaged({
        items: state.items.map((item) => ({ ...item, albumId: albumByItem.get(item.id) ?? null })),
        albums: proposed
      });
    },
    dissolveAlbum(id: string) {
      setStaged({
        items: state.items.map((item) => item.albumId === id ? { ...item, albumId: null } : item),
        albums: state.albums.filter((album) => album.id !== id)
      });
      if (state.selectedAlbumId === id) setState({ selectedAlbumId: null });
    },
    assignItemsToAlbum,
    assignSelectionToAlbum(id: string) {
      assignItemsToAlbum(state.selectedIds, id);
    },
    renumberAlbum(id: string, start = 1, padTo = 0) {
      const album = state.albums.find((candidate) => candidate.id === id);
      if (!album) return;
      const numbers = renumberAlbumTracks(album.itemIds, start, padTo);
      setStaged({
        items: state.items.map((item) => numbers.has(item.id)
          ? { ...item, patch: { ...item.patch, trackNumber: numbers.get(item.id)! }, state: 'dirty' }
          : item),
        albums: state.albums
      });
    },
    async reloadSelected() {
      const targets = state.items.filter((item) => state.selectedIds.includes(item.id))
        .filter((item) => !itemDirty(item) && item.fileHandle && item.document);
      await Promise.all(targets.map(async (item) => {
        try {
          const file = await materializeWorkbenchFile(await item.fileHandle!.getFile());
          const document = await readMetadataDocument(file, item.extension);
          setStaged({
            items: state.items.map((candidate) => candidate.id === item.id
              ? { ...candidate, file, document, state: 'ready', error: '' }
              : candidate),
            albums: state.albums
          }, false);
        } catch (error) {
          setStaged({
            items: state.items.map((candidate) => candidate.id === item.id
              ? { ...candidate, state: 'failed', error: error instanceof Error ? error.message : 'Reload failed.' }
              : candidate),
            albums: state.albums
          }, false);
        }
      }));
      setState({ message: `${targets.length} unchanged file${targets.length === 1 ? '' : 's'} reloaded.` });
    },
    cancelActiveJob: cancelActiveJob,
    saveAndPublish: (options?: Parameters<typeof savePipeline.saveAndPublish>[0]) =>
      savePipeline.saveAndPublish(options),
    previewRenames: (
      template: Parameters<typeof renamePipeline.previewRenames>[0],
      settings: Parameters<typeof renamePipeline.previewRenames>[1]
    ) => renamePipeline.previewRenames(template, settings),
    applyRenamesAndPublish: (
      rows: Parameters<typeof renamePipeline.applyRenamesAndPublish>[0],
      options?: Parameters<typeof renamePipeline.applyRenamesAndPublish>[1]
    ) => renamePipeline.applyRenamesAndPublish(rows, options)
  };
  return api;
}
