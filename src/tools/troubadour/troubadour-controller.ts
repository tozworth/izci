import { writable, type Readable } from 'svelte/store';
import { isSameArtworkFile } from '$lib/services/media-metadata/artwork';
import { applyMetadataPatch } from '$lib/services/media-metadata/merge';
import { getMetadataCapabilities } from '$lib/services/media-metadata/format';
import { readMetadataDocument } from '$lib/services/media-metadata/reader';
import {
  queryMetadataWritePermission,
  requestMetadataWritePermission
} from '$lib/services/media-metadata/permissions';
import type {
  ArtworkEdit,
  MediaArtworkInput,
  MediaMetadataFieldName,
  MediaMetadataFields,
  MetadataDocument,
  MetadataPatch
} from '$lib/services/media-metadata/types';
import type {
  TroubadourBatchItemResult,
  TroubadourBatchTrack,
  TroubadourRememberedFolder,
  TroubadourTrackReference,
  TroubadourWriteTarget
} from '$lib/services/troubadour-sync';
import { requestTroubadourWritePreparation } from '$lib/services/troubadour-sync';
import {
  discoverDirectoryFiles,
  inferExtension,
  inferKind
} from '$lib/utils/files';
import { autoGroupTracks, renumberAlbumTracks } from './grouping';
import { createHistory, pushHistory, redoHistory, undoHistory, type HistoryState } from './history';
import {
  applyRename,
  buildRenamePreview,
  type RenameJobResult,
  type RenamePreviewRow,
  type RenameSource,
  type RenameVerification
} from './rename-job';
import { parseRenameTemplate, renderRenameTemplate, type FilenameRules } from './rename-template';

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

interface StagedWorkbenchState {
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

export interface SaveWorkbenchItem {
  item: TroubadourWorkbenchItem;
  requestPermission: boolean;
  signal?: AbortSignal;
  verify?: boolean;
}

export interface SaveWorkbenchResult {
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

function itemDirty(item: TroubadourWorkbenchItem): boolean {
  return Object.keys(item.patch).length > 0 || item.artworkEdits.length > 0;
}

function itemState(item: TroubadourWorkbenchItem): WorkbenchItemState {
  if (item.state === 'loading' || item.state === 'unsupported' || item.state === 'unreadable') return item.state;
  return itemDirty(item) ? 'dirty' : item.state === 'failed' || item.state === 'conflicted' ? item.state : 'ready';
}

export type TroubadourAutoGroupFallback = 'folder' | 'none';

async function materializeWorkbenchFile(file: File): Promise<File> {
  return new File([await file.arrayBuffer()], file.name, {
    type: file.type,
    lastModified: file.lastModified
  });
}

const LOAD_COMMIT_BATCH_SIZE = 64;
const LOAD_PROGRESS_INTERVAL_MS = 250;

interface DiscoveredWorkbenchFile {
  fileHandle: FileSystemFileHandle;
  parentHandle: FileSystemDirectoryHandle | null;
  path: string;
}

export function effectiveFields(item: TroubadourWorkbenchItem): MediaMetadataFields | null {
  return item.document ? applyMetadataPatch(item.document, item.patch, item.artworkEdits).fields : null;
}

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

function cloneStaged(state: StagedWorkbenchState): StagedWorkbenchState {
  return {
    items: state.items.map((item) => ({
      ...item,
      patch: { ...item.patch },
      artworkEdits: [...item.artworkEdits]
    })),
    albums: state.albums.map((album) => ({ ...album, itemIds: [...album.itemIds] }))
  };
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

function metadataTrackForGrouping(item: TroubadourWorkbenchItem) {
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

function writeTargetForItem(item: TroubadourWorkbenchItem): TroubadourWriteTarget {
  return {
    contextId: item.contextId,
    references: item.references,
    originalPath: item.path,
    originalName: item.file.name,
    originalSize: item.file.size,
    originalLastModified: item.file.lastModified,
    originalFileHandle: item.fileHandle ?? undefined
  };
}

function defaultSaveHandler(): SaveWorkbenchItemHandler {
  return async ({ item, requestPermission, signal, verify }) => {
    const { writeMetadataDocumentInPlace } = await import('$lib/services/media-metadata/writer');
    if (!item.fileHandle || !item.document) throw new Error('This file cannot be written in place.');
    if (requestPermission && await queryMetadataWritePermission(item.fileHandle) === 'prompt') {
      await requestMetadataWritePermission(item.fileHandle);
    }
    return await writeMetadataDocumentInPlace(
      item.fileHandle,
      item.document,
      item.patch,
      item.artworkEdits,
      { signal, verify }
    );
  };
}

export function createTroubadourController(
  saveItem: SaveWorkbenchItemHandler = defaultSaveHandler()
): Readable<TroubadourWorkbenchState> & {
  getSnapshot(): TroubadourWorkbenchState;
  setRememberedFolders(folders: TroubadourRememberedFolder[]): void;
  ingestBatchTracks(
    tracks: TroubadourBatchTrack[],
    concurrency?: number,
    autoGroupFallback?: TroubadourAutoGroupFallback
  ): Promise<void>;
  ingestHandles(
    handles: FileSystemFileHandle[],
    concurrency?: number,
    autoGroupFallback?: TroubadourAutoGroupFallback
  ): Promise<void>;
  ingestDirectory(
    handle: FileSystemDirectoryHandle,
    maxDepth?: number,
    concurrency?: number,
    autoGroupFallback?: TroubadourAutoGroupFallback
  ): Promise<void>;
  ingestDropped(
    dataTransfer: DataTransfer,
    maxDepth?: number,
    concurrency?: number,
    autoGroupFallback?: TroubadourAutoGroupFallback
  ): Promise<void>;
  select(id: string, options?: { additive?: boolean; range?: boolean }): void;
  selectAlbum(id: string): void;
  selectAll(): void;
  clearSelection(): void;
  removeSelected(): void;
  editField(field: MediaMetadataFieldName, value: string | null): void;
  editItemField(id: string, field: MediaMetadataFieldName, value: string | null): void;
  resetField(field: MediaMetadataFieldName): void;
  addArtwork(artwork: MediaArtworkInput, behavior?: 'preserve' | 'replace-kind' | 'reject'): void;
  replaceArtwork(artworkId: string, artwork: MediaArtworkInput): void;
  removeArtwork(artworkId: string): void;
  clearArtwork(): void;
  applyArtworkToAlbum(
    albumId: string,
    artwork: MediaArtworkInput,
    behavior?: 'preserve' | 'replace-kind' | 'reject'
  ): void;
  undo(): void;
  redo(): void;
  createAlbum(title?: string): string | null;
  autoGroup(fallback?: 'folder' | 'none'): void;
  dissolveAlbum(id: string): void;
  assignItemsToAlbum(itemIds: string[], id: string): void;
  assignSelectionToAlbum(id: string): void;
  reorderAlbum(id: string, itemIds: string[]): void;
  renumberAlbum(id: string, start?: number, padTo?: number): void;
  reloadSelected(): Promise<void>;
  saveSelectedOrAll(options?: { all?: boolean; requestPermission?: boolean; verify?: boolean }): Promise<TroubadourBatchItemResult[]>;
  buildRenamePreview(template: string, rules?: FilenameRules): Promise<RenamePreviewRow[]>;
  applyRenames(
    rows: RenamePreviewRow[],
    options?: { signal?: AbortSignal; verification?: RenameVerification }
  ): Promise<{ jobs: RenameJobResult[]; results: TroubadourBatchItemResult[] }>;
} {
  const store = writable<TroubadourWorkbenchState>(EMPTY_STATE);
  let state = EMPTY_STATE;
  let history: HistoryState<StagedWorkbenchState> = createHistory({ items: [], albums: [] });
  let loadGeneration = 0;
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
  const selectionItems = () => state.items.filter((item) => state.selectedIds.includes(item.id));
  const prepareItemForSave = async (id: string): Promise<TroubadourWorkbenchItem | null> => {
    const source = state.items.find((item) => item.id === id);
    if (!source) return null;
    const item = {
      ...source,
      file: await materializeWorkbenchFile(source.file),
      state: 'saving' as const,
      error: ''
    };
    setStaged({
      items: state.items.map((candidate) => candidate.id === item.id ? item : candidate),
      albums: state.albums
    }, false);
    history = createHistory(cloneStaged({ items: state.items, albums: state.albums }));
    setState({ canUndo: false, canRedo: false });
    // Let component references and object URLs switch to the memory-backed File.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return item;
  };
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

  async function runLoadingJob(
    initialJob: string,
    concurrency: number,
    collectItems: (
      report: (activeJob: string, jobProgress?: number | null) => void
    ) => Promise<TroubadourWorkbenchItem[]>,
    autoGroupFallback?: TroubadourAutoGroupFallback
  ): Promise<void> {
    setState({ busy: true, activeJob: initialJob, jobProgress: null, error: '' });
    try {
      const items = await collectItems((activeJob, jobProgress = null) => {
        setState({ activeJob, jobProgress });
      });
      await addLoadingItems(items, concurrency, autoGroupFallback);
    } finally {
      setState({ busy: false, activeJob: '', jobProgress: null });
    }
  }

  async function addLoadingItems(
    nextItems: TroubadourWorkbenchItem[],
    concurrency: number,
    autoGroupFallback?: TroubadourAutoGroupFallback
  ): Promise<void> {
    const known = new Set(state.items.map((item) => `${item.path}\u0000${item.file.size}\u0000${item.file.lastModified}`));
    const unique = nextItems.filter((item) => {
      const key = `${item.path}\u0000${item.file.size}\u0000${item.file.lastModified}`;
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    if (!unique.length) {
      setState({ message: 'No new files were found.' });
      return;
    }
    const generation = loadGeneration;
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
    const workers = Array.from({ length: Math.min(Math.max(1, Math.trunc(concurrency)), unique.length) }, async () => {
      while (index < unique.length && generation === loadGeneration) {
        const current = unique[index++];
        let replacement: TroubadourWorkbenchItem;
        if (!getMetadataCapabilities(current.extension)) {
          replacement = { ...current, state: 'unsupported' };
        } else {
          try {
            const document = await readMetadataDocument(current.file, current.extension);
            replacement = { ...current, document, state: 'ready', error: '' };
          } catch (error) {
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
    commitUpdates(true);
    setState({ message: `${unique.length} file${unique.length === 1 ? '' : 's'} loaded.` });
  }

  async function itemFromHandle(
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

  async function itemsFromDiscoveredFiles(
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

  const api = {
    subscribe: store.subscribe,
    getSnapshot: () => state,
    setRememberedFolders(folders: TroubadourRememberedFolder[]) {
      setState({ rememberedFolders: folders });
    },
    async ingestBatchTracks(
      tracks: TroubadourBatchTrack[],
      concurrency = 3,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ) {
      await runLoadingJob('Opening izci files', concurrency, async (report) => {
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
              const parentHandle = await resolveParentHandle(track.path, track.sourceFolderId, state.rememberedFolders);
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
      }, autoGroupFallback);
    },
    async ingestHandles(
      handles: FileSystemFileHandle[],
      concurrency = 3,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ) {
      await runLoadingJob('Opening files', concurrency, async (report) => {
        return await itemsFromDiscoveredFiles(
          handles.map((fileHandle) => ({ fileHandle, path: fileHandle.name, parentHandle: null })),
          concurrency,
          report,
          'files'
        );
      }, autoGroupFallback);
    },
    async ingestDirectory(
      handle: FileSystemDirectoryHandle,
      maxDepth = Number.POSITIVE_INFINITY,
      concurrency = 3,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ) {
      await runLoadingJob(`Scanning ${handle.name} · 0 files found`, concurrency, async (report) => {
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
      }, autoGroupFallback);
    },
    async ingestDropped(
      dataTransfer: DataTransfer,
      maxDepth = Number.POSITIVE_INFINITY,
      concurrency = 3,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ) {
      await runLoadingJob('Scanning dropped items · 0 files found', concurrency, async (report) => {
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
              path: file.webkitRelativePath || file.name, extension, kind: inferKind(extension) ?? 'stream', state: 'loading',
              document: null, patch: {}, artworkEdits: [], albumId: null, error: '', jobProgress: null
            });
          }
        }
        report(`Scanning dropped items · ${found} file${found === 1 ? '' : 's'} found`);
        return items;
      }, autoGroupFallback);
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
    addArtwork(artwork: MediaArtworkInput, behavior = 'preserve') {
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
    applyArtworkToAlbum(albumId: string, artwork: MediaArtworkInput, behavior = 'preserve') {
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
    reorderAlbum(id: string, itemIds: string[]) {
      const album = state.albums.find((candidate) => candidate.id === id);
      if (!album || itemIds.length !== album.itemIds.length || new Set(itemIds).size !== itemIds.length
        || itemIds.some((itemId) => !album.itemIds.includes(itemId))) return;
      setStaged({ items: state.items, albums: state.albums.map((candidate) => candidate.id === id ? { ...candidate, itemIds } : candidate) });
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
      const targets = selectionItems().filter((item) => !itemDirty(item) && item.fileHandle && item.document);
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
    async saveSelectedOrAll(options: { all?: boolean; requestPermission?: boolean; verify?: boolean } = {}) {
      const selectedDirtyIds = selectionItems().filter((item) => itemDirty(item)).map((item) => item.id);
      const targetIds = (options.all || !selectedDirtyIds.length ? state.items.map((item) => item.id) : selectedDirtyIds)
        .filter((id) => {
          const item = state.items.find((candidate) => candidate.id === id);
          return Boolean(item && itemDirty(item) && item.document && item.fileHandle);
        });
      const results: TroubadourBatchItemResult[] = [];
      // Invoke every permission request before yielding so Chromium still sees the
      // direct Save user activation. Already-granted handles resolve without UI.
      const permissionRequests = options.requestPermission === false
        ? []
        : targetIds.map((id) => requestMetadataWritePermission(state.items.find((item) => item.id === id)!.fileHandle!));
      const playbackPreparation = requestTroubadourWritePreparation(
        targetIds
          .map((id) => state.items.find((item) => item.id === id))
          .filter((item): item is TroubadourWorkbenchItem => Boolean(item))
          .map(writeTargetForItem)
      );
      setState({ busy: true, activeJob: 'Saving metadata', jobProgress: 0, error: '' });
      await Promise.all([...permissionRequests, playbackPreparation]);
      for (let index = 0; index < targetIds.length; index += 1) {
        // Chromium keeps disk-backed File snapshots open on Windows. Replace the
        // workbench reference (and therefore any preview object URL) with a memory
        // copy before the atomic writable tries to swap the original file.
        const item = await prepareItemForSave(targetIds[index]);
        if (!item) continue;
        try {
          const result = await saveItem({
            item,
            requestPermission: options.requestPermission !== false,
            verify: options.verify !== false
          });
          const file = await materializeWorkbenchFile(await item.fileHandle!.getFile());
          setStaged({
            items: state.items.map((candidate) => candidate.id === item.id ? {
              ...candidate,
              file,
              document: result.document,
              patch: {},
              artworkEdits: [],
              state: 'saved',
              error: ''
            } : candidate),
            albums: state.albums
          }, false);
          const fields = result.document.fields;
          results.push({
            success: true,
            contextId: item.contextId,
            references: item.references,
            originalPath: item.path,
            originalName: item.file.name,
            originalSize: item.file.size,
            originalLastModified: item.file.lastModified,
            file,
            fileHandle: item.fileHandle!,
            path: item.path,
            name: file.name,
            extension: item.extension,
            kind: item.kind,
            size: file.size,
            lastModified: file.lastModified,
            metadata: {
              title: fields.title || undefined,
              artist: fields.artist || undefined,
              album: fields.album || undefined,
              albumArtist: fields.albumArtist || undefined,
              genre: fields.genre || undefined,
              year: fields.date || undefined,
              trackNumber: fields.trackNumber || undefined,
              discNumber: fields.discNumber || undefined,
              composer: fields.composer || undefined,
              embeddedMetadataLoaded: true
            },
            artworkChanged: item.artworkEdits.length > 0
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Metadata write failed.';
          const conflicted = error && typeof error === 'object' && 'code' in error && error.code === 'external-change';
          const permissionRequired = error && typeof error === 'object' && 'code' in error && error.code === 'permission-required';
          setStaged({
            items: state.items.map((candidate) => candidate.id === item.id
              ? { ...candidate, state: conflicted ? 'conflicted' : permissionRequired ? 'permission-required' : 'failed', error: message }
              : candidate),
            albums: state.albums
          }, false);
          results.push({
            success: false,
            contextId: item.contextId,
            references: item.references,
            originalPath: item.path,
            originalName: item.file.name,
            originalSize: item.file.size,
            originalLastModified: item.file.lastModified
          });
        }
        setState({ jobProgress: (index + 1) / targetIds.length });
      }
      setState({
        busy: false,
        activeJob: '',
        jobProgress: null,
        canUndo: false,
        canRedo: false,
        message: targetIds.length ? `${results.filter((result) => result.success).length} of ${targetIds.length} files saved.` : 'No writable dirty files.'
      });
      history = createHistory(cloneStaged({ items: state.items, albums: state.albums }));
      return results;
    },
    async buildRenamePreview(template: string, rules: FilenameRules = {}) {
      const nodes = parseRenameTemplate(template);
      const scoped = state.selectedIds.length ? selectionItems() : state.items;
      const sources: RenameSource[] = scoped.map((item) => {
        const fields = effectiveFields(item);
        const tokenFields = Object.fromEntries(
          Object.entries(fields ?? {}).map(([key, value]) => [key.toLocaleLowerCase(), value])
        );
        const rendered = renderRenameTemplate(nodes, {
          ...tokenFields,
          track: fields?.trackNumber,
          disc: fields?.discNumber,
          filename: item.file.name.replace(/\.[^.]+$/, ''),
          extension: item.extension
        });
        return {
          id: item.id,
          file: item.file,
          fileHandle: item.fileHandle,
          parentHandle: item.parentHandle,
          path: item.path,
          proposedBaseName: rendered.value,
          extension: item.extension,
          missingTokens: rendered.missing,
          expectedLastModified: item.file.lastModified,
          expectedSize: item.file.size,
          expectedFingerprint: item.document?.fingerprint
        };
      });
      return await buildRenamePreview(sources, rules);
    },
    async applyRenames(
      rows: RenamePreviewRow[],
      options: { signal?: AbortSignal; verification?: RenameVerification } = {}
    ) {
      const targets = rows.filter((row) => row.enabled && !row.problems.length);
      const jobs: RenameJobResult[] = [];
      const results: TroubadourBatchItemResult[] = [];
      setState({ busy: true, activeJob: 'Renaming files', jobProgress: 0, error: '' });
      for (let index = 0; index < targets.length; index += 1) {
        const row = targets[index];
        const item = state.items.find((candidate) => candidate.id === row.id)!;
        const job = await applyRename(row, options.signal, options.verification);
        jobs.push(job);
        if (job.success) {
          const document = await readMetadataDocument(job.file, item.extension);
          setStaged({
            items: state.items.map((candidate) => candidate.id === item.id ? {
              ...candidate,
              file: job.file,
              fileHandle: job.fileHandle,
              path: job.path,
              document,
              state: itemDirty(candidate) ? 'dirty' : 'ready',
              error: ''
            } : candidate),
            albums: state.albums
          }, false);
          results.push({
            success: true,
            contextId: item.contextId,
            references: item.references,
            originalPath: item.path,
            originalName: item.file.name,
            originalSize: item.file.size,
            originalLastModified: item.file.lastModified,
            file: job.file,
            fileHandle: job.fileHandle,
            path: job.path,
            name: job.name,
            extension: item.extension,
            kind: item.kind,
            size: job.file.size,
            lastModified: job.file.lastModified
          });
        } else {
          results.push({
            success: false,
            contextId: item.contextId,
            references: item.references,
            originalPath: item.path,
            originalName: item.file.name,
            originalSize: item.file.size,
            originalLastModified: item.file.lastModified
          });
        }
        setState({ jobProgress: (index + 1) / targets.length });
      }
      setState({ busy: false, activeJob: '', jobProgress: null, message: `${jobs.filter((job) => job.success).length} of ${targets.length} files renamed.` });
      history = createHistory(cloneStaged({ items: state.items, albums: state.albums }));
      setState({ canUndo: false, canRedo: false });
      return { jobs, results };
    }
  };
  return api;
}
