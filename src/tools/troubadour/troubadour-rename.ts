import { readMetadataDocument } from '$lib/services/media-metadata/reader';
import type { TroubadourBatchItemResult } from '$lib/services/troubadour-sync';
import { publishTroubadourBatchResult } from '$lib/services/troubadour-sync';
import { logInfo } from '$lib/services/logging';
import type { TroubadourSettings } from '$lib/stores/troubadour-settings';
import { createHistory, type HistoryState } from './history';
import {
  applyRename,
  buildRenamePreview,
  type RenameJobResult,
  type RenamePreviewRow,
  type RenameSource,
  type RenameVerification
} from './rename-job';
import { parseRenameTemplate, renderRenameTemplate, type FilenameRules } from './rename-template';
import { effectiveFields } from './troubadour-loading';
import { cloneStaged, itemDirty } from './troubadour-staged';
import type {
  StagedWorkbenchState,
  TroubadourWorkbenchItem,
  TroubadourWorkbenchState
} from './troubadour-controller';

export async function requestRenameAccess(rows: RenamePreviewRow[]): Promise<void> {
  const handles = new Set<FileSystemHandle>();
  for (const row of rows) {
    if (!row.problems.includes('permission-required')) continue;
    if (row.parentHandle) handles.add(row.parentHandle);
    if (row.fileHandle) handles.add(row.fileHandle);
  }
  // Invoke every request before yielding so Chromium retains the button's user activation.
  const requests = [...handles].map((handle) => handle.requestPermission?.({ mode: 'readwrite' }) ?? Promise.resolve('granted' as const));
  await Promise.all(requests);
}

export function buildRenameSources(
  items: TroubadourWorkbenchItem[],
  template: string
): RenameSource[] {
  const nodes = parseRenameTemplate(template);
  return items.map((item) => {
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
}

export function renameRulesFromSettings(settings: TroubadourSettings): FilenameRules {
  return {
    illegalCharacterReplacement: settings.illegalCharacterReplacement,
    normalizeWhitespace: settings.normalizeWhitespace,
    unicodeNormalization: settings.unicodeNormalization === 'nfc'
      ? 'NFC'
      : settings.unicodeNormalization === 'ascii' ? 'ascii' : 'none',
    extensionCase: settings.extensionCase,
    missingTokenPolicy: settings.missingTokenPolicy,
    collisionPolicy: settings.collisionPolicy
  };
}

export interface RenamePipeline {
  buildRenamePreview(template: string, rules?: FilenameRules): Promise<RenamePreviewRow[]>;
  applyRenames(
    rows: RenamePreviewRow[],
    options?: { signal?: AbortSignal; verification?: RenameVerification }
  ): Promise<{ jobs: RenameJobResult[]; results: TroubadourBatchItemResult[] }>;
  previewRenames(template: string, settings: TroubadourSettings): Promise<RenamePreviewRow[]>;
  applyRenamesAndPublish(
    rows: RenamePreviewRow[],
    options?: {
      saveFirst?: boolean;
      verification?: RenameVerification;
      refreshPreview?: () => Promise<void>;
      settings?: TroubadourSettings;
    }
  ): Promise<void>;
}

export function createTroubadourRenamePipeline(deps: {
  state: () => TroubadourWorkbenchState;
  history: () => HistoryState<StagedWorkbenchState>;
  setHistory: (history: HistoryState<StagedWorkbenchState>) => void;
  setJob: (activeJob: string, jobProgress: number | null) => void;
  setStaged: (staged: StagedWorkbenchState, record?: boolean, statePatch?: Partial<TroubadourWorkbenchState>) => void;
  setState: (patch: Partial<TroubadourWorkbenchState>) => void;
  setBusyComplete: (message: string) => void;
  saveSelectedOrAll: (options?: {
    all?: boolean;
    requestPermission?: boolean;
    verify?: boolean;
    settings?: TroubadourSettings;
  }) => Promise<TroubadourBatchItemResult[]>;
  /** Returns the signal that cancels this batch when cancelActiveJob() fires. */
  beginBatch: () => AbortSignal;
}): RenamePipeline {
  const {
    state: getState,
    history: getHistory,
    setHistory,
    setJob,
    setStaged,
    setState,
    setBusyComplete,
    saveSelectedOrAll,
    beginBatch
  } = deps;

  return {
    async buildRenamePreview(template: string, rules: FilenameRules = {}) {
      const state = getState();
      const scoped = state.selectedIds.length
        ? state.items.filter((item) => state.selectedIds.includes(item.id))
        : state.items;
      const sources = buildRenameSources(scoped, template);
      return await buildRenamePreview(sources, rules);
    },
    async applyRenames(
      rows: RenamePreviewRow[],
      options: { signal?: AbortSignal; verification?: RenameVerification } = {}
    ) {
      const targets = rows.filter((row) => row.enabled && !row.problems.length);
      const jobs: RenameJobResult[] = [];
      const results: TroubadourBatchItemResult[] = [];
      // An external signal (tests, callers) wins; otherwise the batch signal
      // from the controller lets cancelActiveJob() stop a running rename.
      const signal = options.signal ?? beginBatch();
      setState({ busy: true, activeJob: 'Renaming files', jobProgress: 0, error: '' });
      for (let index = 0; index < targets.length; index += 1) {
        if (signal.aborted) break;
        const row = targets[index];
        const item = getState().items.find((candidate) => candidate.id === row.id)!;
        const job = await applyRename(row, signal, options.verification);
        jobs.push(job);
        if (job.success) {
          const document = await readMetadataDocument(job.file, item.extension);
          setStaged({
            items: getState().items.map((candidate) => candidate.id === item.id ? {
              ...candidate,
              file: job.file,
              fileHandle: job.fileHandle,
              path: job.path,
              document,
              state: itemDirty(candidate) ? 'dirty' : 'ready',
              error: ''
            } : candidate),
            albums: getState().albums
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
        setJob('Renaming files', (index + 1) / targets.length);
      }
      setBusyComplete(signal.aborted
        ? 'Rename cancelled.'
        : `${jobs.filter((job) => job.success).length} of ${targets.length} files renamed.`);
      setHistory(createHistory(cloneStaged({ items: getState().items, albums: getState().albums })));
      setState({ canUndo: false, canRedo: false });
      return { jobs, results };
    },
    async previewRenames(template: string, settings: TroubadourSettings) {
      return await this.buildRenamePreview(template, renameRulesFromSettings(settings));
    },
    async applyRenamesAndPublish(
      rows: RenamePreviewRow[],
      options: {
        saveFirst?: boolean;
        verification?: RenameVerification;
        refreshPreview?: () => Promise<void>;
        settings?: TroubadourSettings;
      } = {}
    ) {
      if (options.saveFirst) {
        const saveResults = await saveSelectedOrAll({ verify: true, requestPermission: true, settings: options.settings });
        publishTroubadourBatchResult({ results: saveResults });
        await options.refreshPreview?.();
      }
      const { results } = await this.applyRenames(rows, { verification: options.verification });
      publishTroubadourBatchResult({ results });
      await options.refreshPreview?.();
      if (options.settings?.diagnosticJobReporting && rows.length) {
        logInfo('tools', 'Troubadour rename batch completed', {
          total: rows.length,
          renamed: results.filter((result) => result.success).length,
          verification: options.verification ?? 'metadata'
        });
      }
    }
  };
}
