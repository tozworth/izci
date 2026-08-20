import {
  queryMetadataWritePermission,
  requestMetadataWritePermission
} from '$lib/services/media-metadata/permissions';
import type {
  TroubadourBatchItemResult,
  TroubadourWriteTarget
} from '$lib/services/troubadour-sync';
import {
  publishTroubadourBatchResult,
  requestTroubadourWritePreparation
} from '$lib/services/troubadour-sync';
import { createHistory, type HistoryState } from './history';
import { materializeWorkbenchFile } from './troubadour-loading';
import { cloneStaged, itemDirty } from './troubadour-staged';
import type {
  SaveWorkbenchItemHandler,
  StagedWorkbenchState,
  TroubadourWorkbenchItem,
  TroubadourWorkbenchState,
  WorkbenchItemState
} from './troubadour-controller';

export {
  buildRenameSources,
  createTroubadourRenamePipeline,
  renameRulesFromSettings,
  requestRenameAccess,
  type RenamePipeline
} from './troubadour-rename';
export { itemDirty };

export function writeTargetForItem(item: TroubadourWorkbenchItem): TroubadourWriteTarget {
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

export function defaultSaveHandler(): SaveWorkbenchItemHandler {
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

export interface SavePipeline {
  saveSelectedOrAll(options?: { all?: boolean; requestPermission?: boolean; verify?: boolean }): Promise<TroubadourBatchItemResult[]>;
  saveAndPublish(options?: { all?: boolean; requestPermission?: boolean; verify?: boolean }): Promise<TroubadourBatchItemResult[]>;
}

export function itemState(item: TroubadourWorkbenchItem): WorkbenchItemState {
  if (item.state === 'loading' || item.state === 'unsupported' || item.state === 'unreadable') return item.state;
  return itemDirty(item) ? 'dirty' : item.state === 'failed' || item.state === 'conflicted' ? item.state : 'ready';
}

export function createTroubadourSavePipeline(deps: {
  state: () => TroubadourWorkbenchState;
  history: () => HistoryState<StagedWorkbenchState>;
  setHistory: (history: HistoryState<StagedWorkbenchState>) => void;
  setJob: (activeJob: string, jobProgress: number | null) => void;
  setStaged: (staged: StagedWorkbenchState, record?: boolean, statePatch?: Partial<TroubadourWorkbenchState>) => void;
  setState: (patch: Partial<TroubadourWorkbenchState>) => void;
  setBusyComplete: (message: string) => void;
  saveItem: SaveWorkbenchItemHandler;
}): SavePipeline {
  const {
    state: getState,
    history: getHistory,
    setHistory,
    setJob,
    setStaged,
    setState,
    setBusyComplete,
    saveItem
  } = deps;

  const prepareItemForSave = async (id: string): Promise<TroubadourWorkbenchItem | null> => {
    const source = getState().items.find((item) => item.id === id);
    if (!source) return null;
    const item = {
      ...source,
      file: await materializeWorkbenchFile(source.file),
      state: 'saving' as const,
      error: ''
    };
    setStaged({
      items: getState().items.map((candidate) => candidate.id === item.id ? item : candidate),
      albums: getState().albums
    }, false);
    setHistory(createHistory(cloneStaged({ items: getState().items, albums: getState().albums })));
    setState({ canUndo: false, canRedo: false });
    // Let component references and object URLs switch to the memory-backed File.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return item;
  };

  return {
    async saveSelectedOrAll(options: { all?: boolean; requestPermission?: boolean; verify?: boolean } = {}) {
      const state = getState();
      const selectedDirtyIds = state.items
        .filter((item) => state.selectedIds.includes(item.id) && itemDirty(item))
        .map((item) => item.id);
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
            items: getState().items.map((candidate) => candidate.id === item.id ? {
              ...candidate,
              file,
              document: result.document,
              patch: {},
              artworkEdits: [],
              state: 'saved',
              error: ''
            } : candidate),
            albums: getState().albums
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
            items: getState().items.map((candidate) => candidate.id === item.id
              ? { ...candidate, state: conflicted ? 'conflicted' : permissionRequired ? 'permission-required' : 'failed', error: message }
              : candidate),
            albums: getState().albums
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
        setJob('Saving metadata', (index + 1) / targetIds.length);
      }
      setBusyComplete(targetIds.length ? `${results.filter((result) => result.success).length} of ${targetIds.length} files saved.` : 'No writable dirty files.');
      setHistory(createHistory(cloneStaged({ items: getState().items, albums: getState().albums })));
      return results;
    },
    async saveAndPublish(options: { all?: boolean; requestPermission?: boolean; verify?: boolean } = {}) {
      const results = await this.saveSelectedOrAll(options);
      publishTroubadourBatchResult({ results });
      return results;
    }
  };
}
