<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import ColumnListView from '$lib/components/ColumnListView.svelte';
  import type { ColumnListViewColumn } from '$lib/components/column-list-view';
  import {
    clearLogs, getLogEntries, logError, logInfo, subscribeLogs,
    type LogEntry, type LogLevel
  } from '$lib/services/logging';
  import { loggingSettings } from '$lib/stores/logging-settings';
  import {
    compareLogEntries, fitLogWidthsToAvailableWidth, formatLogTimestamp, getLogColumnIcon,
    LOG_COLUMN_IDS, LOG_COLUMN_MIN_WIDTHS, logsColumnVisibility, logsColumnWidths,
    logsSort, rebalanceLogColumnWidths, type LogColumnId, type LogColumnWidths
  } from './logs-columns';
  import { logsLevelVisibility } from './logs-levels';
  import { formatDiagnosticsExport, formatLogLine } from './logs-export';
  import LogsMenuBar from './LogsMenuBar.svelte';

  const COLUMN_GAP = 4;
  const TABLE_SIDE_PADDING = 8;
  let entries: LogEntry[] = [];
  let autoScroll = true;
  let listElement: HTMLElement | null = null;
  let listWidth = 0;
  let resizingColumnId: LogColumnId | null = null;
  let resizeStartX = 0;
  let resizeStartWidths: LogColumnWidths = logsColumnWidths.getSnapshot();

  $: enabledLevels = $logsLevelVisibility;
  $: visibleEntries = entries.filter((entry) => enabledLevels[entry.level]);
  $: visibleColumnIds = LOG_COLUMN_IDS.filter((id) => $logsColumnVisibility[id]);
  $: sortState = $logsSort;
  $: sortedEntries = [...visibleEntries].sort((left, right) => compareLogEntries(left, right, sortState));
  $: availableWidth = Math.max(0, listWidth - 2 * TABLE_SIDE_PADDING - Math.max(0, visibleColumnIds.length - 1) * COLUMN_GAP);
  $: resolvedWidths = fitLogWidthsToAvailableWidth($logsColumnWidths, availableWidth, visibleColumnIds);
  $: allColumns = LOG_COLUMN_IDS.map((id): ColumnListViewColumn => ({
    id, label: columnLabel(id), width: resolvedWidths[id], minWidth: LOG_COLUMN_MIN_WIDTHS[id],
    icon: getLogColumnIcon(id), visible: $logsColumnVisibility[id]
  }));
  $: visibleColumns = allColumns.filter((column) => column.visible);

  function columnLabel(id: LogColumnId): string {
    if (id === 'time') return $t('logs.columns.time', { default: 'Time' });
    if (id === 'level') return $t('logs.columns.level', { default: 'Level' });
    if (id === 'source') return $t('logs.columns.source', { default: 'Source' });
    if (id === 'context') return $t('logs.columns.context', { default: 'Context' });
    if (id === 'message') return $t('logs.columns.message', { default: 'Message' });
    return $t('logs.columns.details', { default: 'Details' });
  }

  function cellValue(entry: LogEntry, id: LogColumnId): string {
    if (id === 'time') return formatLogTimestamp(entry.timestamp);
    if (id === 'level') return entry.level === 'warning' ? 'warn' : entry.level;
    if (id === 'source') return entry.source;
    if (id === 'context') return entry.context;
    if (id === 'message') return entry.message;
    return entry.details ?? '';
  }

  function exportName(): string {
    return `izci-logs-${new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}.log`;
  }

  async function saveText(text: string, suggestedName: string): Promise<void> {
    type WritableLogHandle = {
      createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
    };
    const picker = (window as Window & {
      showSaveFilePicker?: (options: unknown) => Promise<WritableLogHandle>;
    }).showSaveFilePicker;
    if (picker) {
      const handle = await picker({ suggestedName, types: [{ description: 'Log file', accept: { 'text/plain': ['.log'] } }] });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportLogs(): Promise<void> {
    const snapshot = getLogEntries();
    const name = exportName();
    try {
      await saveText(formatDiagnosticsExport(snapshot), name);
      logInfo('tools', 'Logs exported', { entries: snapshot.length, file: name });
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') logError('tools', 'Log export failed', error);
    }
  }

  async function copyVisible(): Promise<void> {
    if (sortedEntries.length === 0) return;
    try {
      await navigator.clipboard.writeText(sortedEntries.map(formatLogLine).join('\n'));
    } catch (error) {
      logError('tools', 'Copying logs failed', error);
    }
  }

  function toggleLevel(level: LogLevel): void {
    const current = logsLevelVisibility.getSnapshot();
    logsLevelVisibility.setVisibility({ ...current, [level]: !current[level] });
  }

  function toggleColumn(id: LogColumnId): void {
    const current = logsColumnVisibility.getSnapshot();
    if (current[id] && LOG_COLUMN_IDS.filter((columnId) => current[columnId]).length === 1) return;
    logsColumnVisibility.setVisibility({ ...current, [id]: !current[id] });
  }

  function handleResizeStart(event: PointerEvent, id: LogColumnId): void {
    event.preventDefault();
    event.stopPropagation();
    resizingColumnId = id;
    resizeStartX = event.clientX;
    resizeStartWidths = $logsColumnWidths;
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!resizingColumnId) return;
    logsColumnWidths.setWidths(rebalanceLogColumnWidths(resizeStartWidths, resizingColumnId, event.clientX - resizeStartX, visibleColumnIds));
  }

  function scrollIfPinned(): void {
    if (!autoScroll) return;
    void tick().then(() => listElement?.scrollTo({ top: listElement.scrollHeight }));
  }

  onMount(() => subscribeLogs((next) => {
    entries = next;
    scrollIfPinned();
  }));
</script>

<svelte:head><title>izci Logs</title></svelte:head>
<div class="window-frame-safe-strip" aria-hidden="true"></div>
<div class="tool-shell logs-shell" aria-label={$t('logs.heading', { default: 'Logs' })}>
  <LogsMenuBar
    entryCount={entries.length}
    visibleEntryCount={visibleEntries.length}
    {autoScroll}
    captureDebug={$loggingSettings.captureDebug}
    mirrorToConsole={$loggingSettings.mirrorToConsole}
    {enabledLevels}
    on:exportLogs={() => void exportLogs()}
    on:copy={() => void copyVisible()}
    on:clear={clearLogs}
    on:toggleAutoScroll={() => autoScroll = !autoScroll}
    on:toggleLevel={(event) => toggleLevel(event.detail)}
    on:toggleDebugCapture={() => loggingSettings.update({ captureDebug: !$loggingSettings.captureDebug })}
    on:toggleConsoleMirror={() => loggingSettings.update({ mirrorToConsole: !$loggingSettings.mirrorToConsole })}
    on:close={() => window.close()}
  />

  <ColumnListView
    columns={visibleColumns}
    {allColumns}
    bind:scrollElement={listElement}
    bind:clientWidth={listWidth}
    columnGap={`${COLUMN_GAP}px`}
    contextMenuLabel={$t('logs.contextMenu.columns', { default: 'Log columns' })}
    {resizingColumnId}
    activeSort={sortState}
    role="log"
    aria-live="polite"
    on:resizeStart={(event) => handleResizeStart(event.detail.event, event.detail.columnId as LogColumnId)}
    on:visibilityToggle={(event) => toggleColumn(event.detail as LogColumnId)}
  >
    <svelte:fragment slot="headerCell" let:column let:sorted>
      <button type="button" class="clv-column-sort-button" class:is-sorted={sorted} on:click={() => logsSort.setSort(column.id as LogColumnId)}>
        <span class="clv-column-sort-content">
          <span class="clv-column-label">{column.label}</span>
          {#if sorted}<span class="material-symbols-outlined clv-column-sort-icon" aria-hidden="true">{sortState.direction === 'asc' ? 'expand_less' : 'expand_more'}</span>{/if}
        </span>
      </button>
    </svelte:fragment>

    {#if visibleEntries.length === 0}
      <div class="logs-empty">{entries.length === 0 ? $t('logs.empty', { default: 'No log entries yet.' }) : $t('logs.emptyFiltered', { default: 'No entries at the selected levels.' })}</div>
    {:else}
      {#each sortedEntries as entry (entry.id)}
        <div class="logs-row level-{entry.level}" data-log-id={entry.id}>
          {#each visibleColumns as column}
            <span class="logs-cell logs-{column.id}" title={cellValue(entry, column.id as LogColumnId)}>{cellValue(entry, column.id as LogColumnId)}</span>
          {/each}
        </div>
      {/each}
    {/if}
  </ColumnListView>
</div>

<svelte:window on:pointermove={handlePointerMove} on:pointerup={() => resizingColumnId = null} />
