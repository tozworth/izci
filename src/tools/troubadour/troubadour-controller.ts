import { writable, type Readable } from 'svelte/store';
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
  TroubadourTrackReference
} from '$lib/services/troubadour-sync';
import { inferExtension, inferKind } from '$lib/utils/files';
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
  ingestBatchTracks(tracks: TroubadourBatchTrack[], concurrency?: number): Promise<void>;
  ingestHandles(handles: FileSystemFileHandle[], concurrency?: number): Promise<void>;
  ingestDirectory(handle: FileSystemDirectoryHandle, maxDepth?: number, concurrency?: number): Promise<void>;
  ingestDropped(dataTransfer: DataTransfer, maxDepth?: number, concurrency?: number): Promise<void>;
  select(id: string, options?: { additive?: boolean; range?: boolean }): void;
  selectAlbum(id: string): void;
  selectAll(): void;
  clearSelection(): void;
  removeSelected(): void;
  editField(field: MediaMetadataFieldName, value: string | null): void;
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
  const setStaged = (staged: StagedWorkbenchState, record = true) => {
    const next = cloneStaged(staged);
    history = record ? pushHistory(history, next) : { ...history, present: next };
    store.set({
      ...state,
      ...next,
      canUndo: history.undo.length > 0,
      canRedo: history.redo.length > 0
    });
  };
  const selectionItems = () => state.items.filter((item) => state.selectedIds.includes(item.id));

  async function addLoadingItems(nextItems: TroubadourWorkbenchItem[], concurrency: number): Promise<void> {
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
    const items = [...state.items, ...unique];
    setStaged({ items, albums: state.albums }, false);
    let index = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, Math.trunc(concurrency)), unique.length) }, async () => {
      while (index < unique.length && generation === loadGeneration) {
        const current = unique[index++];
        if (!getMetadataCapabilities(current.extension)) {
          setStaged({
            items: state.items.map((item) => item.id === current.id ? { ...item, state: 'unsupported' } : item),
            albums: state.albums
          }, false);
          continue;
        }
        try {
          const document = await readMetadataDocument(current.file, current.extension);
          setStaged({
            items: state.items.map((item) => item.id === current.id
              ? { ...item, document, state: 'ready', error: '' }
              : item),
            albums: state.albums
          }, false);
        } catch (error) {
          setStaged({
            items: state.items.map((item) => item.id === current.id
              ? { ...item, state: 'unreadable', error: error instanceof Error ? error.message : 'Metadata could not be read.' }
              : item),
            albums: state.albums
          }, false);
        }
      }
    });
    await Promise.all(workers);
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

  async function walkDirectory(
    directory: FileSystemDirectoryHandle,
    path: string,
    maxDepth: number,
    depth = 0
  ): Promise<TroubadourWorkbenchItem[]> {
    const found: TroubadourWorkbenchItem[] = [];
    for await (const entry of directory.values()) {
      if (entry.kind === 'file') {
        found.push(await itemFromHandle(entry as FileSystemFileHandle, `${path}/${entry.name}`, directory));
      } else if (depth < maxDepth) {
        found.push(...await walkDirectory(
          entry as FileSystemDirectoryHandle,
          `${path}/${entry.name}`,
          maxDepth,
          depth + 1
        ));
      }
    }
    return found;
  }

  const api = {
    subscribe: store.subscribe,
    getSnapshot: () => state,
    setRememberedFolders(folders: TroubadourRememberedFolder[]) {
      setState({ rememberedFolders: folders });
    },
    async ingestBatchTracks(tracks: TroubadourBatchTrack[], concurrency = 3) {
      const items: TroubadourWorkbenchItem[] = [];
      for (const track of tracks) {
        try {
          const file = track.fileHandle ? await track.fileHandle.getFile() : track.file;
          if (!file) continue;
          const parentHandle = await resolveParentHandle(track.path, track.sourceFolderId, state.rememberedFolders);
          items.push({
            id: track.contextId || crypto.randomUUID(),
            contextId: track.contextId,
            references: track.references,
            file,
            fileHandle: track.fileHandle ?? null,
            parentHandle,
            path: track.path || file.name,
            sourceFolderId: track.sourceFolderId,
            extension: track.extension || inferExtension(file.name),
            kind: track.kind,
            state: 'loading',
            document: null,
            patch: {},
            artworkEdits: [],
            albumId: null,
            error: '',
            jobProgress: null
          });
        } catch {
          // Stale handles are represented only when a File snapshot is available.
        }
      }
      await addLoadingItems(items, concurrency);
    },
    async ingestHandles(handles: FileSystemFileHandle[], concurrency = 3) {
      await addLoadingItems(await Promise.all(handles.map((handle) => itemFromHandle(handle, handle.name, null))), concurrency);
    },
    async ingestDirectory(handle: FileSystemDirectoryHandle, maxDepth = Number.POSITIVE_INFINITY, concurrency = 3) {
      await addLoadingItems(await walkDirectory(handle, handle.name, maxDepth), concurrency);
    },
    async ingestDropped(dataTransfer: DataTransfer, maxDepth = Number.POSITIVE_INFINITY, concurrency = 3) {
      const items: TroubadourWorkbenchItem[] = [];
      for (const transferItem of Array.from(dataTransfer.items)) {
        const handle = await transferItem.getAsFileSystemHandle?.().catch(() => null);
        if (handle?.kind === 'file') {
          items.push(await itemFromHandle(handle as FileSystemFileHandle, handle.name, null));
        } else if (handle?.kind === 'directory') {
          items.push(...await walkDirectory(handle as FileSystemDirectoryHandle, handle.name, maxDepth));
        }
      }
      if (!items.length) {
        for (const file of Array.from(dataTransfer.files)) {
          const extension = inferExtension(file.name);
          items.push({
            id: crypto.randomUUID(), references: [], file, fileHandle: null, parentHandle: null,
            path: file.webkitRelativePath || file.name, extension, kind: inferKind(extension) ?? 'stream', state: 'loading',
            document: null, patch: {}, artworkEdits: [], albumId: null, error: '', jobProgress: null
          });
        }
      }
      await addLoadingItems(items, concurrency);
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
    assignSelectionToAlbum(id: string) {
      const selected = new Set(state.selectedIds);
      const target = state.albums.find((album) => album.id === id);
      if (!target) return;
      setStaged({
        items: state.items.map((item) => selected.has(item.id) ? { ...item, albumId: id } : item),
        albums: state.albums.map((album) => ({
          ...album,
          itemIds: album.id === id
            ? [...new Set([...album.itemIds, ...state.selectedIds])]
            : album.itemIds.filter((itemId) => !selected.has(itemId))
        })).filter((album) => album.itemIds.length > 0)
      });
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
          const file = await item.fileHandle!.getFile();
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
      const selectedDirty = selectionItems().filter((item) => itemDirty(item));
      const targets = (options.all || !selectedDirty.length ? state.items : selectedDirty)
        .filter((item) => itemDirty(item) && item.document && item.fileHandle);
      const results: TroubadourBatchItemResult[] = [];
      // Invoke every permission request before yielding so Chromium still sees the
      // direct Save user activation. Already-granted handles resolve without UI.
      const permissionRequests = options.requestPermission === false
        ? []
        : targets.map((item) => requestMetadataWritePermission(item.fileHandle!));
      setState({ busy: true, activeJob: 'Saving metadata', jobProgress: 0, error: '' });
      await Promise.all(permissionRequests);
      for (let index = 0; index < targets.length; index += 1) {
        const item = targets[index];
        setStaged({
          items: state.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'saving', error: '' } : candidate),
          albums: state.albums
        }, false);
        try {
          const result = await saveItem({
            item,
            requestPermission: options.requestPermission !== false,
            verify: options.verify !== false
          });
          const file = await item.fileHandle!.getFile();
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
        setState({ jobProgress: (index + 1) / targets.length });
      }
      setState({
        busy: false,
        activeJob: '',
        jobProgress: null,
        canUndo: false,
        canRedo: false,
        message: targets.length ? `${results.filter((result) => result.success).length} of ${targets.length} files saved.` : 'No writable dirty files.'
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
