<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import type { MenuActionItem } from '$lib/types';
  import {
    analyzeLoudness,
    computeIntegratedLoudness,
    DEFAULT_REPLAYGAIN_TARGET_LUFS,
    replayGainForLoudness,
    type LoudnessAnalysis
  } from '../loudness/loudness-analyzer';
  import { writeReplayGainInPlace } from '../loudness/replaygain-writer';
  import type { TroubadourWorkbenchItem } from './troubadour-controller';

  type RowState = 'ready' | 'analyzing' | 'analyzed' | 'writing' | 'written' | 'error';
  type AlbumGrouping = 'tags' | 'folder' | 'all' | 'none';

  interface LoudnessRow {
    itemId: string;
    fingerprint: string;
    state: RowState;
    progress: number | null;
    analysis: LoudnessAnalysis | null;
    albumIntegratedLufs: number | null;
    albumPeak: number | null;
    error: string;
  }

  export let items: TroubadourWorkbenchItem[] = [];
  export let selectedIds: string[] = [];
  export let workbenchBusy = false;

  const dispatch = createEventDispatcher<{
    toggleSelection: string;
    selectAll: void;
    clearSelection: void;
    removeSelected: void;
    written: void;
    busyChange: boolean;
  }>();

  let rows: LoudnessRow[] = [];
  let targetLufs = DEFAULT_REPLAYGAIN_TARGET_LUFS;
  let albumGrouping: AlbumGrouping = 'tags';
  let parallelism = 1;
  let busy = false;
  let message = '';
  let errorMessage = '';
  let abortController: AbortController | null = null;
  let contextMenuRowId: string | null = null;
  let contextMenuX = 0;
  let contextMenuY = 0;
  let lastItems: TroubadourWorkbenchItem[] | null = null;

  $: if (items !== lastItems) syncRows(items);
  $: streamItems = items.filter((item) => item.kind === 'stream');
  $: itemById = new Map(streamItems.map((item) => [item.id, item]));
  $: selectedRows = rows.filter((row) => selectedIds.includes(row.itemId));
  $: analyzedSelectedRows = selectedRows.filter((row) => row.analysis && row.state !== 'analyzing');
  $: writableSelectedRows = analyzedSelectedRows.filter((row) => {
    const item = itemById.get(row.itemId);
    return item?.fileHandle && !isDirty(item);
  });
  $: allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.itemId));
  $: effectiveTargetLufs = Number.isFinite(targetLufs)
    ? Math.min(-5, Math.max(-30, targetLufs))
    : DEFAULT_REPLAYGAIN_TARGET_LUFS;
  $: contextMenuItems = contextMenuRowId ? buildRowContextMenu() : [];

  function fingerprint(item: TroubadourWorkbenchItem): string {
    return `${item.file.name}\u0000${item.file.size}\u0000${item.file.lastModified}`;
  }

  function freshRow(item: TroubadourWorkbenchItem): LoudnessRow {
    return {
      itemId: item.id,
      fingerprint: fingerprint(item),
      state: 'ready',
      progress: null,
      analysis: null,
      albumIntegratedLufs: null,
      albumPeak: null,
      error: ''
    };
  }

  function syncRows(nextItems: TroubadourWorkbenchItem[]): void {
    lastItems = nextItems;
    const previous = new Map(rows.map((row) => [row.itemId, row]));
    rows = nextItems
      .filter((item) => item.kind === 'stream')
      .map((item) => {
        const row = previous.get(item.id);
        return row?.fingerprint === fingerprint(item) ? row : freshRow(item);
      });
    recomputeAlbums();
  }

  function isDirty(item: TroubadourWorkbenchItem): boolean {
    return Object.keys(item.patch).length > 0 || item.artworkEdits.length > 0;
  }

  function updateRow(itemId: string, update: Partial<LoudnessRow>): void {
    rows = rows.map((row) => row.itemId === itemId ? { ...row, ...update } : row);
  }

  function setAllSelected(selected: boolean): void {
    dispatch(selected ? 'selectAll' : 'clearSelection');
  }

  function folderOf(path: string): string {
    const separator = path.lastIndexOf('/');
    return separator >= 0 ? path.slice(0, separator) : '';
  }

  function albumKey(row: LoudnessRow): string | null {
    if (!row.analysis || albumGrouping === 'none') return null;
    if (albumGrouping === 'all') return 'all';
    const item = itemById.get(row.itemId);
    const folder = folderOf(item?.path ?? '');
    if (albumGrouping === 'folder') return folder || 'picked-files';
    const album = row.analysis.album?.toLocaleLowerCase();
    const albumArtist = row.analysis.albumArtist?.toLocaleLowerCase();
    return album ? `tags:${albumArtist ?? ''}\u0000${album}` : folder ? `folder:${folder}` : `track:${row.itemId}`;
  }

  function recomputeAlbums(): void {
    const groups = new Map<string, LoudnessRow[]>();
    for (const row of rows) {
      const key = albumKey(row);
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const values = new Map<string, { loudness: number; peak: number }>();
    for (const [key, group] of groups) {
      values.set(key, {
        loudness: computeIntegratedLoudness(group.flatMap((row) => row.analysis?.blockEnergies ?? [])),
        peak: Math.max(...group.map((row) => row.analysis?.samplePeak ?? 0))
      });
    }
    rows = rows.map((row) => {
      const key = albumKey(row);
      const album = key ? values.get(key) : null;
      return { ...row, albumIntegratedLufs: album?.loudness ?? null, albumPeak: album?.peak ?? null };
    });
  }

  function handleGroupingChange(event: Event): void {
    albumGrouping = (event.currentTarget as HTMLSelectElement).value as AlbumGrouping;
    recomputeAlbums();
  }

  function setBusy(value: boolean): void {
    busy = value;
    dispatch('busyChange', value);
  }

  async function analyzeSelected(): Promise<void> {
    const queued = selectedRows.filter((row) => itemById.has(row.itemId));
    if (!queued.length || busy || workbenchBusy) return;
    setBusy(true);
    message = '';
    errorMessage = '';
    abortController = new AbortController();
    let cursor = 0;
    const worker = async () => {
      while (cursor < queued.length && !abortController?.signal.aborted) {
        const row = queued[cursor++];
        const item = itemById.get(row.itemId);
        if (!item) continue;
        updateRow(row.itemId, { state: 'analyzing', progress: 0, analysis: null, albumIntegratedLufs: null, albumPeak: null, error: '' });
        try {
          const analysis = await analyzeLoudness(item.file, {
            signal: abortController?.signal,
            onProgress: ({ seconds, duration }) => updateRow(row.itemId, {
              progress: duration && duration > 0 ? Math.min(1, seconds / duration) : null
            })
          });
          updateRow(row.itemId, { state: 'analyzed', progress: 1, analysis });
        } catch (error) {
          if ((error as DOMException)?.name === 'AbortError') updateRow(row.itemId, { state: 'ready', progress: null });
          else updateRow(row.itemId, { state: 'error', progress: null, error: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    const analyzerCount = Math.min(queued.length, Math.min(4, Math.max(1, Math.round(Number(parallelism) || 1))));
    await Promise.all(Array.from({ length: analyzerCount }, worker));
    const wasCancelled = Boolean(abortController?.signal.aborted);
    abortController = null;
    setBusy(false);
    recomputeAlbums();
    message = wasCancelled
      ? $t('loudness.cancelled', { default: 'Analysis cancelled.' })
      : $t('loudness.analysisComplete', { default: 'Analysis complete.' });
  }

  function stopAnalysis(): void {
    abortController?.abort();
  }

  async function writeSelected(): Promise<void> {
    const queued = writableSelectedRows;
    if (!queued.length || busy || workbenchBusy) return;
    setBusy(true);
    message = '';
    errorMessage = '';
    let written = 0;
    for (const row of queued) {
      const item = itemById.get(row.itemId);
      if (!row.analysis || !item?.fileHandle) continue;
      updateRow(row.itemId, { state: 'writing', error: '' });
      try {
        await writeReplayGainInPlace(item.fileHandle, {
          trackGainDb: replayGainForLoudness(row.analysis.integratedLufs, effectiveTargetLufs),
          trackPeak: row.analysis.samplePeak,
          albumGainDb: row.albumIntegratedLufs === null ? undefined : replayGainForLoudness(row.albumIntegratedLufs, effectiveTargetLufs),
          albumPeak: row.albumPeak ?? undefined
        });
        written += 1;
        updateRow(row.itemId, { state: 'written' });
      } catch (error) {
        updateRow(row.itemId, { state: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }
    setBusy(false);
    message = $t('loudness.writeComplete', { default: 'Wrote ReplayGain tags to {count} files.', values: { count: written } });
    if (written) dispatch('written');
  }

  function formatLoudness(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return Number.isFinite(value) ? `${value.toFixed(2)} LUFS` : '−∞ LUFS';
  }

  function formatGain(row: LoudnessRow): string {
    if (!row.analysis || !Number.isFinite(row.analysis.integratedLufs)) return '—';
    const gain = replayGainForLoudness(row.analysis.integratedLufs, effectiveTargetLufs);
    return `${gain >= 0 ? '+' : ''}${gain.toFixed(2)} dB`;
  }

  function formatPeak(value: number | undefined): string {
    if (value === undefined) return '—';
    return Number.isFinite(value) ? `${value.toFixed(2)} dBFS` : '−∞ dBFS';
  }

  function statusText(row: LoudnessRow): string {
    const item = itemById.get(row.itemId);
    if (row.error) return row.error;
    if (item && isDirty(item)) return $t('loudness.status.saveStagedFirst', { default: 'Save staged metadata before writing gain tags' });
    switch (row.state) {
      case 'ready': return item?.fileHandle ? $t('loudness.status.ready', { default: 'Ready' }) : $t('loudness.status.readOnly', { default: 'Analyze only' });
      case 'analyzing': return row.progress === null
        ? $t('loudness.status.analyzing', { default: 'Analyzing...' })
        : $t('loudness.status.analyzingPercent', { default: 'Analyzing {percent}%', values: { percent: Math.round(row.progress * 100) } });
      case 'analyzed': return $t('loudness.status.analyzed', { default: 'Analyzed' });
      case 'writing': return $t('loudness.status.writing', { default: 'Writing...' });
      case 'written': return $t('loudness.status.written', { default: 'Tagged' });
      case 'error': return $t('loudness.status.error', { default: 'Failed' });
    }
  }

  function buildRowContextMenu(): MenuActionItem[] {
    return [
      { id: 'analyze', label: $t('loudness.analyzeSelected', { default: 'Analyze selected' }), icon: 'query_stats', disabled: busy || workbenchBusy || !selectedRows.length },
      { id: 'stop', label: $t('loudness.stop', { default: 'Stop' }), icon: 'stop_circle', disabled: !abortController },
      { id: 'write', label: $t('loudness.writeSelected', { default: 'Write tags in-place' }), icon: 'save', disabled: busy || workbenchBusy || !writableSelectedRows.length },
      { id: 'selectAll', label: $t('loudness.selectAll', { default: 'Select all' }), icon: 'select_all', separatorBefore: true, disabled: busy || workbenchBusy || !rows.length },
      { id: 'selectNone', label: $t('loudness.menu.selectNone', { default: 'Select none' }), icon: 'deselect', disabled: busy || workbenchBusy || !rows.length },
      { id: 'removeSelected', label: $t('loudness.removeSelected', { default: 'Remove selected' }), icon: 'remove', separatorBefore: true, disabled: busy || workbenchBusy || !selectedRows.length }
    ];
  }

  function openRowContextMenu(event: MouseEvent, row: LoudnessRow): void {
    contextMenuRowId = row.itemId;
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
  }

  function runRowContextAction(action: string): void {
    contextMenuRowId = null;
    if (action === 'analyze') void analyzeSelected();
    else if (action === 'stop') stopAnalysis();
    else if (action === 'write') void writeSelected();
    else if (action === 'selectAll') dispatch('selectAll');
    else if (action === 'selectNone') dispatch('clearSelection');
    else if (action === 'removeSelected') dispatch('removeSelected');
  }

  onDestroy(() => {
    abortController?.abort();
    if (busy) dispatch('busyChange', false);
  });
</script>

<section class="loudness-workbench" aria-label={$t('loudness.title', { default: 'Loudness' })}>
  <div class="tool-row tool-toolbar loudness-toolbar" role="toolbar" aria-label={$t('loudness.toolbar', { default: 'Loudness tools' })}>
    <button class="text-button primary" type="button" on:click={analyzeSelected} disabled={busy || workbenchBusy || selectedRows.length === 0}><span class="material-symbols-outlined" aria-hidden="true">query_stats</span>{$t('loudness.analyzeSelected', { default: 'Analyze selected' })}</button>
    {#if abortController}<button class="icon-button danger hover-tooltip-anchor" type="button" on:click={stopAnalysis} aria-label={$t('loudness.stop', { default: 'Stop' })}><span class="material-symbols-outlined" aria-hidden="true">stop_circle</span><HoverTooltip>{$t('loudness.stop', { default: 'Stop' })}</HoverTooltip></button>{/if}
    <button class="text-button" type="button" on:click={writeSelected} disabled={busy || workbenchBusy || writableSelectedRows.length === 0}><span class="material-symbols-outlined" aria-hidden="true">save</span>{$t('loudness.writeSelected', { default: 'Write tags in-place' })}</button>
    <div class="toolbar-spacer"></div>
    <label class="loudness-compact-control"><span>{$t('loudness.targetShort', { default: 'Target' })}</span><input bind:value={targetLufs} type="number" min="-30" max="-5" step="0.5" disabled={busy || workbenchBusy} /><span>LUFS</span></label>
    <select class="loudness-grouping-select" value={albumGrouping} on:change={handleGroupingChange} disabled={busy || workbenchBusy} aria-label={$t('loudness.albumGrouping', { default: 'Album grouping' })}>
      <option value="tags">{$t('loudness.group.tags', { default: 'Album tags, then folder' })}</option><option value="folder">{$t('loudness.group.folder', { default: 'Containing folder' })}</option><option value="all">{$t('loudness.group.all', { default: 'All analyzed files' })}</option><option value="none">{$t('loudness.group.none', { default: 'Track gain only' })}</option>
    </select>
    <label class="loudness-compact-control loudness-analyzers-control"><span>{$t('loudness.parallelShort', { default: 'Jobs' })}</span><input bind:value={parallelism} type="number" min="1" max="4" step="1" disabled={busy || workbenchBusy} /></label>
  </div>

  <div class="loudness-table">
    <div class="loudness-table-header" role="row"><label class="loudness-check-cell" title={$t('loudness.selectAll', { default: 'Select all' })}><input type="checkbox" checked={allSelected} on:change={() => setAllSelected(!allSelected)} /></label><span>{$t('loudness.file', { default: 'File' })}</span><span>{$t('loudness.integrated', { default: 'Integrated' })}</span><span>{$t('loudness.peak', { default: 'Sample peak' })}</span><span>{$t('loudness.trackGain', { default: 'Track gain' })}</span><span>{$t('loudness.albumGain', { default: 'Album gain' })}</span><span>{$t('loudness.status.label', { default: 'Status' })}</span></div>
    <div class="loudness-table-body">
      {#each rows as row (row.itemId)}
        {@const item = itemById.get(row.itemId)}
        {#if item}<div class:error={row.state === 'error'} class="loudness-result-row" role="row" tabindex="-1" on:contextmenu|preventDefault={(event) => openRowContextMenu(event, row)}>
          <label class="loudness-check-cell"><input type="checkbox" checked={selectedIds.includes(row.itemId)} disabled={busy || workbenchBusy} on:change={() => dispatch('toggleSelection', row.itemId)} /></label>
          <div class="loudness-file-cell" title={item.path}><strong>{item.file.name}</strong><span>{item.path}</span></div>
          <span>{formatLoudness(row.analysis?.integratedLufs)}</span><span>{formatPeak(row.analysis?.samplePeakDbfs)}</span>
          <span class:clipping={Boolean(row.analysis && row.analysis.samplePeak * (10 ** (replayGainForLoudness(row.analysis.integratedLufs, effectiveTargetLufs) / 20)) > 1)}>{formatGain(row)}</span>
          <span>{row.albumIntegratedLufs === null ? '—' : `${replayGainForLoudness(row.albumIntegratedLufs, effectiveTargetLufs) >= 0 ? '+' : ''}${replayGainForLoudness(row.albumIntegratedLufs, effectiveTargetLufs).toFixed(2)} dB`}</span>
          <div class="loudness-status-cell" title={statusText(row)}>{#if row.state === 'analyzing' && row.progress !== null}<progress max="1" value={row.progress}></progress>{/if}<span>{statusText(row)}</span></div>
        </div>{/if}
      {:else}<div class="loudness-empty-state"><span class="material-symbols-outlined" aria-hidden="true">audio_file</span><strong>{$t('loudness.empty', { default: 'Add audio' })}</strong><span>{$t('loudness.emptyHint', { default: 'or drop files and folders here' })}</span></div>{/each}
    </div>
  </div>

  <footer class="tool-status-bar" class:error={Boolean(errorMessage)}>{#if errorMessage || message || busy}<span class="material-symbols-outlined">{errorMessage ? 'error' : busy ? 'progress_activity' : 'info'}</span>{/if}<span>{errorMessage || message}</span><span class="summary">{rows.length} {$t('loudness.files', { default: 'files' })} · {analyzedSelectedRows.length} {$t('loudness.analyzedCount', { default: 'analyzed' })}</span></footer>
  {#if contextMenuRowId}<MenuSurface items={contextMenuItems} x={contextMenuX} y={contextMenuY} ariaLabel={$t('loudness.menu.analysis', { default: 'Analysis' })} enableOverflowSubmenuFallback on:action={(event) => runRowContextAction(event.detail)} on:dismiss={() => (contextMenuRowId = null)} />{/if}
</section>
