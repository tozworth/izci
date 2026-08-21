import { logInfo } from '$lib/services/logging';
import { readMetadataDocument } from '$lib/services/media-metadata/reader';
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
import type { TroubadourSettings } from '$lib/stores/troubadour-settings';
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
  return async ({ item, requestPermission, signal, verify, fullVerification }) => {
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
      { signal, verify, fullVerification }
    );
  };
}

export interface SavePipeline {
  saveSelectedOrAll(options?: {
    all?: boolean;
    requestPermission?: boolean;
    verify?: boolean;
    settings?: TroubadourSettings;
  }): Promise<TroubadourBatchItemResult[]>;
  saveAndPublish(options?: {
    all?: boolean;
    requestPermission?: boolean;
    verify?: boolean;
    settings?: TroubadourSettings;
  }): Promise<TroubadourBatchItemResult[]>;
}

export function itemState(item: TroubadourWorkbenchItem): WorkbenchItemState {
  if (item.state === 'loading' || item.state === 'unsupported' || item.state === 'unreadable') return item.state;
  return itemDirty(item) ? 'dirty' : item.state === 'failed' || item.state === 'conflicted' ? item.state : 'ready';
}

/** Copies the original file next to itself (sibling) or into a "izci-backup" folder before writing. */
async function createBackup(item: TroubadourWorkbenchItem, policy: TroubadourSettings['backupPolicy']): Promise<void> {
  const parent = item.parentHandle;
  if (!parent) throw new Error('A backup was requested but the parent directory handle is unavailable.');
  const directory = policy === 'backup-folder'
    ? await parent.getDirectoryHandle('izci-backup', { create: true })
    : parent;
  const backup = await directory.getFileHandle(`${item.file.name}.izci-bak`, { create: true });
  const writable = await backup.createWritable!();
  try {
    await item.file.stream().pipeTo(writable);
  } catch {
    await directory.removeEntry(backup.name).catch(() => undefined);
    throw new Error('The backup could not be written; the original file was left untouched.');
  }
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
  /** Returns the signal that cancels this batch when cancelActiveJob() fires. */
  beginBatch: () => AbortSignal;
}): SavePipeline {
  const {
    state: getState,
    history: getHistory,
    setHistory,
    setJob,
    setStaged,
    setState,
    setBusyComplete,
    saveItem,
    beginBatch
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
    async saveSelectedOrAll(options: {
      all?: boolean;
      requestPermission?: boolean;
      verify?: boolean;
      settings?: TroubadourSettings;
    } = {}) {
      const settings = options.settings;
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
      const signal = beginBatch();
      setState({ busy: true, activeJob: 'Saving metadata', jobProgress: 0, error: '' });
      await Promise.all([...permissionRequests, playbackPreparation]);
      for (let index = 0; index < targetIds.length; index += 1) {
        if (signal.aborted) break;
        // Chromium keeps disk-backed File snapshots open on Windows. Replace the
        // workbench reference (and therefore any preview object URL) with a memory
        // copy before the atomic writable tries to swap the original file.
        const item = await prepareItemForSave(targetIds[index]);
        if (!item) continue;
        try {
          if (settings && settings.backupPolicy !== 'none' && item.parentHandle) {
            await createBackup(item, settings.backupPolicy);
          }
          const result = await saveItem({
            item,
            requestPermission: options.requestPermission !== false,
            verify: options.verify !== false,
            fullVerification: settings?.postWriteVerification === 'full-metadata',
            signal
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
          if (signal.aborted && (error instanceof DOMException ? error.name === 'AbortError' : signal.aborted)) {
            // Cancellation: restore the item to dirty and leave the file untouched.
            setStaged({
              items: getState().items.map((candidate) => candidate.id === item.id
                ? { ...candidate, state: itemDirty(candidate) ? 'dirty' : 'ready', error: '' }
                : candidate),
              albums: getState().albums
            }, false);
            setBusyComplete('Save cancelled.');
            setHistory(createHistory(cloneStaged({ items: getState().items, albums: getState().albums })));
            return results;
          }
          const message = error instanceof Error ? error.message : 'Metadata write failed.';
          const conflicted = error && typeof error === 'object' && 'code' in error && error.code === 'external-change';
          const permissionRequired = error && typeof error === 'object' && 'code' in error && error.code === 'permission-required';
          let itemStateAfterError: WorkbenchItemState = conflicted
            ? 'conflicted'
            : permissionRequired ? 'permission-required' : 'failed';
          if (conflicted && settings?.externalChangeBehavior === 'reload-unchanged') {
            try {
              const file = await materializeWorkbenchFile(await item.fileHandle!.getFile());
              const document = await readMetadataDocument(file, item.extension);
              setStaged({
                items: getState().items.map((candidate) => candidate.id === item.id
                  ? { ...candidate, file, document, state: 'ready', error: '', patch: {}, artworkEdits: [] }
                  : candidate),
                albums: getState().albums
              }, false);
              itemStateAfterError = 'ready';
            } catch {
              // Keep the conflicted state when the reload itself fails.
            }
          }
          if (itemStateAfterError !== 'ready') {
            setStaged({
              items: getState().items.map((candidate) => candidate.id === item.id
                ? { ...candidate, state: itemStateAfterError, error: message }
                : candidate),
              albums: getState().albums
            }, false);
          }
          results.push({
            success: false,
            contextId: item.contextId,
            references: item.references,
            originalPath: item.path,
            originalName: item.file.name,
            originalSize: item.file.size,
            originalLastModified: item.file.lastModified
          });
          if (!conflicted && !permissionRequired && settings?.batchErrorBehavior === 'stop') {
            setJob('Saving metadata', (index + 1) / targetIds.length);
            setBusyComplete(`Batch stopped after a failed write: ${message}`);
            setHistory(createHistory(cloneStaged({ items: getState().items, albums: getState().albums })));
            if (settings?.diagnosticJobReporting) {
              logInfo('tools', 'Troubadour save batch stopped', { stoppedAfter: item.file.name, saved: results.filter((result) => result.success).length, error: message });
            }
            return results;
          }
        }
        setJob('Saving metadata', (index + 1) / targetIds.length);
      }
      const cancelled = signal.aborted;
      setBusyComplete(cancelled
        ? 'Save cancelled.'
        : targetIds.length ? `${results.filter((result) => result.success).length} of ${targetIds.length} files saved.` : 'No writable dirty files.');
      setHistory(createHistory(cloneStaged({ items: getState().items, albums: getState().albums })));
      if (settings?.diagnosticJobReporting && targetIds.length) {
        logInfo('tools', 'Troubadour save batch completed', {
          total: targetIds.length,
          saved: results.filter((result) => result.success).length,
          backupPolicy: settings.backupPolicy,
          verified: options.verify !== false
        });
      }
      return results;
    },
    async saveAndPublish(options: {
      all?: boolean;
      requestPermission?: boolean;
      verify?: boolean;
      settings?: TroubadourSettings;
    } = {}) {
      const results = await this.saveSelectedOrAll(options);
      publishTroubadourBatchResult({ results });
      return results;
    }
  };
}
