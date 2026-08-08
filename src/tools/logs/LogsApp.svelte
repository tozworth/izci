<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    clearLogs,
    getLogEntries,
    logError,
    logInfo,
    subscribeLogs,
    type LogEntry,
    type LogLevel
  } from '$lib/services/logging';
  import {
    compareLogEntries,
    fitLogWidthsToAvailableWidth,
    getLogColumnIcon,
    LOG_COLUMN_IDS,
    LOG_COLUMN_MIN_WIDTHS,
    logsColumnVisibility,
    logsColumnWidths,
    logsSort,
    rebalanceLogColumnWidths,
    type LogColumnId,
    type LogColumnWidths
  } from './logs-columns';
  import { logsLevelVisibility } from './logs-levels';
  import ColumnListView from '$lib/components/ColumnListView.svelte';
  import type { ColumnListViewColumn } from '$lib/components/column-list-view';
  import LogsMenuBar from './LogsMenuBar.svelte';

  const COLUMN_GAP = 4;
  const TABLE_SIDE_PADDING = 8;

  let entries: LogEntry[] = [];
  // Independent per-level visibility: an entry shows if its level is ticked.
  // Persisted via logsLevelVisibility (localStorage + BroadcastChannel).
  $: enabledLevels = $logsLevelVisibility;
  let autoScroll = true;
  let listElement: HTMLElement | null = null;
  let listWidth = 0;
  let resizingColumnId: LogColumnId | null = null;
  let resizeStartX = 0;
  let resizeStartWidths: LogColumnWidths = logsColumnWidths.getSnapshot();

  $: visibleEntries = entries.filter((entry) => enabledLevels[entry.level]);
  $: visibleColumnIds = LOG_COLUMN_IDS.filter((columnId) => $logsColumnVisibility[columnId]);
  $: visibleColumnCount = visibleColumnIds.length;
  $: sortState = $logsSort;
  $: sortedEntries = visibleEntries.sort((left, right) => compareLogEntries(left, right, sortState));
  $: newestEntry = visibleEntries.reduce<LogEntry | null>(
    (newest, entry) => (newest === null || entry.timestamp > newest.timestamp ? entry : newest),
    null
  );
  $: tableInnerWidth = Math.max(
    0,
    listWidth - 2 * TABLE_SIDE_PADDING - Math.max(0, visibleColumnCount - 1) * COLUMN_GAP
  );
  $: resolvedWidths = fitLogWidthsToAvailableWidth($logsColumnWidths, tableInnerWidth, visibleColumnIds);
  $: columnDefs = LOG_COLUMN_IDS.map((columnId): ColumnListViewColumn => ({
    id: columnId,
    label: columnLabel(columnId),
    width: resolvedWidths[columnId],
    minWidth: LOG_COLUMN_MIN_WIDTHS[columnId],
    icon: getLogColumnIcon(columnId),
    visible: $logsColumnVisibility[columnId]
  }));
  $: visibleColumnDefs = columnDefs.filter((column) => column.visible);

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number, length = 2) => String(value).padStart(length, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  }

  function levelColumnLabel(level: LogLevel): string {
    switch (level) {
      case 'warning':
        return 'warn';
      default:
        return level;
    }
  }

  function columnLabel(columnId: LogColumnId): string {
    switch (columnId) {
      case 'time':
        return $t('logs.columns.time', { default: 'Time' });
      case 'level':
        return $t('logs.columns.level', { default: 'Level' });
      case 'source':
        return $t('logs.columns.source', { default: 'Source' });
      case 'window':
        return $t('logs.columns.window', { default: 'Window' });
      case 'message':
        return $t('logs.columns.message', { default: 'Message' });
      case 'details':
        return $t('logs.columns.details', { default: 'Details' });
    }
  }

  function formatEntry(entry: LogEntry): string {
    const details = entry.details ? ` ${entry.details}` : '';
    return `${formatTime(entry.timestamp)} [${entry.level}] [${entry.source}] [${entry.window}] ${entry.message}${details}`;
  }

  function formatExportLine(entry: LogEntry): string {
    const date = new Date(entry.timestamp);
    const pad = (value: number, length = 2) => String(value).padStart(length, '0');
    const timestamp =
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
    const details = entry.details ? ` ${entry.details}` : '';
    return `${timestamp} [${entry.level}] [${entry.source}] [${entry.window}] ${entry.message}${details}`;
  }

  function exportFileName(): string {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
      `izci-logs-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.log`
    );
  }

  async function saveTextFile(blob: Blob, suggestedName: string): Promise<void> {
    const pickerWindow = window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<{
        createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
      }>;
    };

    if (pickerWindow.showSaveFilePicker) {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Log file', accept: { 'text/plain': ['.log'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportLogs(): Promise<void> {
    const all = getLogEntries();
    const text = all.length === 0 ? '' : `${all.map(formatExportLine).join('\n')}\n`;
    const blob = new Blob([text], { type: 'text/plain' });
    const suggestedName = exportFileName();
    try {
      await saveTextFile(blob, suggestedName);
      logInfo('tools', 'Logs exported', { entries: all.length, bytes: blob.size, file: suggestedName });
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      logError('tools', 'Log export failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  function scrollToBottomIfPinned(): void {
    if (!autoScroll || !listElement) return;
    void tick().then(() => {
      const entry = newestEntry;
      if (!entry) return;

      // Follow the newest line wherever the active sort puts it.
      const row = listElement!.querySelector<HTMLElement>(`[data-log-id="${CSS.escape(entry.id)}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    });
  }

  async function copyVisible(): Promise<void> {
    const text = sortedEntries.map(formatEntry).join('\n');
    if (text.length === 0) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be unavailable (non-secure context); nothing to surface.
    }
  }

  function handleColumnSort(columnId: LogColumnId): void {
    logsSort.setSort(columnId);
  }

  function sortColumnLabel(column: ColumnListViewColumn): string {
    return $t('logs.columns.sortBy', {
      default: 'Sort by {column}',
      values: { column: columnLabel(column.id as LogColumnId) }
    });
  }

  function toggleLevel(level: LogLevel): void {
    logsLevelVisibility.setVisibility({
      ...logsLevelVisibility.getSnapshot(),
      [level]: !logsLevelVisibility.getSnapshot()[level]
    });
  }

  function handleColumnVisibilityToggle(columnId: LogColumnId): void {
    const current = logsColumnVisibility.getSnapshot();

    if (current[columnId] && LOG_COLUMN_IDS.filter((id) => current[id]).length === 1) {
      return;
    }

    logsColumnVisibility.setVisibility({ ...current, [columnId]: !current[columnId] });
  }

  function columnResizeLabel(column: ColumnListViewColumn): string {
    return $t('logs.columns.resize', {
      default: 'Resize {column} column',
      values: { column: columnLabel(column.id as LogColumnId) }
    });
  }

  function logCellValue(entry: LogEntry, columnId: LogColumnId): string {
    switch (columnId) {
      case 'time':
        return formatTime(entry.timestamp);
      case 'level':
        return levelColumnLabel(entry.level);
      case 'source':
        return entry.source;
      case 'window':
        return entry.window;
      case 'message':
        return entry.message;
      case 'details':
        return entry.details ?? '';
    }
  }

  function handleColumnResizeStart(event: PointerEvent, columnId: LogColumnId): void {
    event.preventDefault();
    event.stopPropagation();
    resizingColumnId = columnId;
    resizeStartX = event.clientX;
    resizeStartWidths = $logsColumnWidths;
  }

  function handleWindowPointerMove(event: PointerEvent): void {
    if (!resizingColumnId) return;
    logsColumnWidths.setWidths(
      rebalanceLogColumnWidths(
        resizeStartWidths,
        resizingColumnId,
        event.clientX - resizeStartX,
        visibleColumnIds
      )
    );
  }

  function handleWindowPointerUp(): void {
    resizingColumnId = null;
  }

  onMount(() => {
    const unsubscribe = subscribeLogs((list) => {
      entries = list;
      scrollToBottomIfPinned();
    });

    return unsubscribe;
  });
</script>

<svelte:head><title>izci Logs</title></svelte:head>

<div class="window-frame-safe-strip" aria-hidden="true"></div>
<div class="tool-shell logs-shell" aria-label={$t('logs.heading', { default: 'Logs' })}>
  <LogsMenuBar
    entryCount={entries.length}
    visibleEntryCount={visibleEntries.length}
    autoScroll={autoScroll}
    enabledLevels={enabledLevels}
    on:exportLogs={() => void exportLogs()}
    on:copy={() => void copyVisible()}
    on:clear={clearLogs}
    on:toggleAutoScroll={() => {
      autoScroll = !autoScroll;
    }}
    on:toggleLevel={(event) => toggleLevel(event.detail)}
    on:close={() => window.close()}
  />

  <ColumnListView
    columns={visibleColumnDefs}
    allColumns={columnDefs}
    bind:scrollElement={listElement}
    bind:clientWidth={listWidth}
    columnGap={`${COLUMN_GAP}px`}
    contextMenuLabel={$t('logs.contextMenu.columns', { default: 'Log columns' })}
    resizingColumnId={resizingColumnId}
    activeSort={sortState}
    resizeLabel={columnResizeLabel}
    role="log"
    aria-live="polite"
    on:resizeStart={(event) =>
      handleColumnResizeStart(event.detail.event, event.detail.columnId as LogColumnId)}
    on:visibilityToggle={(event) => handleColumnVisibilityToggle(event.detail as LogColumnId)}
  >
    <svelte:fragment slot="headerCell" let:column let:sorted>
      <button
        type="button"
        class="clv-column-sort-button"
        class:is-sorted={sorted}
        class:is-right-aligned={column.rightAligned}
        title={sortColumnLabel(column)}
        on:click={() => handleColumnSort(column.id as LogColumnId)}
      >
        <span class="clv-column-sort-content" class:is-right-aligned={column.rightAligned}>
          <span class="clv-column-label">{column.label}</span>
          {#if sorted}
            <span class="material-symbols-outlined clv-column-sort-icon" aria-hidden="true">
              {sortState.direction === 'asc' ? 'expand_less' : 'expand_more'}
            </span>
          {/if}
        </span>
      </button>
    </svelte:fragment>

    {#if visibleEntries.length === 0}
      <div class="logs-empty">
        {entries.length === 0
          ? $t('logs.empty', { default: 'No log entries yet.' })
          : $t('logs.emptyFiltered', { default: 'No entries at the selected levels.' })}
      </div>
    {:else}
      {#each sortedEntries as entry (entry.id)}
        <div class="logs-row level-{entry.level}" data-log-id={entry.id}>
          {#each visibleColumnDefs as column}
            <span
              class="logs-cell logs-{column.id}"
              title={logCellValue(entry, column.id as LogColumnId)}
            >
              {logCellValue(entry, column.id as LogColumnId)}
            </span>
          {/each}
        </div>
      {/each}
    {/if}
  </ColumnListView>
</div>

<svelte:window onpointermove={handleWindowPointerMove} onpointerup={handleWindowPointerUp} />
