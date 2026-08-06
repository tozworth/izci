<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import SelectDropdown from '$lib/components/SelectDropdown.svelte';
  import {
    clearLogs,
    getLogEntries,
    LOG_LEVELS,
    logError,
    logInfo,
    subscribeLogs,
    type LogEntry,
    type LogLevel
  } from '$lib/services/logging';
  import {
    fitLogWidthsToAvailableWidth,
    LOG_COLUMN_IDS,
    logsColumnWidths,
    rebalanceLogColumnWidths,
    type LogColumnId,
    type LogColumnWidths
  } from './logs-columns';
  import LogsMenuBar from './LogsMenuBar.svelte';

  const COLUMN_GAP = 4;
  const TABLE_SIDE_PADDING = 8;

  // Severity ranks: picking a level shows it and everything more severe.
  const LEVEL_SEVERITY: Record<LogLevel, number> = {
    error: 0,
    warning: 1,
    info: 2,
    debug: 3
  };

  let entries: LogEntry[] = [];
  let filter: LogLevel = 'debug';
  let autoScroll = true;
  let copied = false;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let listElement: HTMLElement | undefined;
  let listWidth = 0;
  let resizingColumnId: LogColumnId | null = null;
  let resizeStartX = 0;
  let resizeStartWidths: LogColumnWidths = logsColumnWidths.getSnapshot();

  $: visibleEntries = entries.filter(
    (entry) => LEVEL_SEVERITY[entry.level] <= LEVEL_SEVERITY[filter]
  );
  $: counts = {
    error: entries.filter((entry) => entry.level === 'error').length,
    warning: entries.filter((entry) => LEVEL_SEVERITY[entry.level] <= LEVEL_SEVERITY.warning).length,
    info: entries.filter((entry) => LEVEL_SEVERITY[entry.level] <= LEVEL_SEVERITY.info).length,
    debug: entries.filter((entry) => LEVEL_SEVERITY[entry.level] <= LEVEL_SEVERITY.debug).length
  };
  $: levelMenuOptions = LOG_LEVELS.map((level) => ({
    value: level,
    label: `${levelLabel(level)} (${counts[level]})`
  }));
  $: levelFilterTooltip = $t('logs.levelFilter', { default: 'Log level' });
  $: tableInnerWidth = Math.max(
    0,
    listWidth - 2 * TABLE_SIDE_PADDING - Math.max(0, LOG_COLUMN_IDS.length - 1) * COLUMN_GAP
  );
  $: resolvedWidths = fitLogWidthsToAvailableWidth($logsColumnWidths, tableInnerWidth);
  $: tableTemplateColumns = LOG_COLUMN_IDS.map(
    (columnId) => `minmax(${resolvedWidths[columnId]}px, ${resolvedWidths[columnId]}px)`
  ).join(' ');

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number, length = 2) => String(value).padStart(length, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  }

  function levelLabel(level: LogLevel): string {
    switch (level) {
      case 'error':
        return $t('logs.levels.error', { default: 'Error' });
      case 'warning':
        return $t('logs.levels.warning', { default: 'Warning' });
      case 'info':
        return $t('logs.levels.info', { default: 'Info' });
      case 'debug':
        return $t('logs.levels.debug', { default: 'Debug' });
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
      listElement!.scrollTop = listElement!.scrollHeight;
    });
  }

  async function copyVisible(): Promise<void> {
    const text = visibleEntries.map(formatEntry).join('\n');
    if (text.length === 0) return;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copied = false;
      }, 1200);
    } catch {
      // Clipboard may be unavailable (non-secure context); nothing to surface.
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
      rebalanceLogColumnWidths(resizeStartWidths, resizingColumnId, event.clientX - resizeStartX)
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

    if (listElement) {
      listWidth = Math.round(listElement.clientWidth);

      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver((resizeEntries) => {
          const entry = resizeEntries[0];
          if (entry) listWidth = Math.round(entry.contentRect.width);
        });
        observer.observe(listElement);
        return () => {
          unsubscribe();
          observer.disconnect();
        };
      }
    }

    return unsubscribe;
  });
</script>

<svelte:head><title>izci Logs</title></svelte:head>

<div class="window-frame-safe-strip" aria-hidden="true"></div>
<div class="tool-shell logs-shell" aria-label={$t('logs.heading', { default: 'Logs' })}>
  <LogsMenuBar
    entryCount={entries.length}
    on:exportLogs={() => void exportLogs()}
    on:close={() => window.close()}
  />

  <div class="tool-toolbar logs-toolbar" role="toolbar" aria-label={$t('logs.toolbar', { default: 'Log tools' })}>
    <div class="logs-level-filter">
      <SelectDropdown
        value={filter}
        options={levelMenuOptions}
        label={$t('logs.levelsLabel', { default: 'Level filter' })}
        tooltip={levelFilterTooltip}
        menuMinWidth={190}
        on:change={(event) => {
          filter = event.detail as LogLevel;
        }}
      />
    </div>
    <span class="toolbar-spacer"></span>
    <label class="logs-toolbar-check">
      <input type="checkbox" bind:checked={autoScroll} />
      <span>{$t('logs.autoScroll', { default: 'Auto-scroll' })}</span>
    </label>
    <button type="button" class="text-button logs-toolbar-control" onclick={() => void copyVisible()}>
      <span class="material-symbols-outlined" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>
      <span>{copied
        ? $t('logs.copied', { default: 'Copied' })
        : $t('logs.copy', { default: 'Copy' })}</span>
    </button>
    <button type="button" class="text-button logs-toolbar-control" onclick={clearLogs}>
      <span class="material-symbols-outlined" aria-hidden="true">delete_sweep</span>
      <span>{$t('logs.clear', { default: 'Clear' })}</span>
    </button>
  </div>

  <div
    class="logs-list"
    bind:this={listElement}
    role="log"
    aria-live="polite"
    style={`--logs-template-columns: ${tableTemplateColumns}; --logs-column-gap: ${COLUMN_GAP}px;`}
  >
    <div class="logs-columns-header" role="row">
      {#each LOG_COLUMN_IDS as columnId (columnId)}
        <div class="logs-column-header" class:is-resizing={resizingColumnId === columnId} role="columnheader">
          <span class="logs-column-label">{columnLabel(columnId)}</span>
          <button
            type="button"
            class="logs-column-resizer"
            aria-label={$t('logs.columns.resize', {
              default: 'Resize {column} column',
              values: { column: columnLabel(columnId) }
            })}
            title={$t('logs.columns.resize', {
              default: 'Resize {column} column',
              values: { column: columnLabel(columnId) }
            })}
            onpointerdown={(event) => handleColumnResizeStart(event, columnId)}
          ></button>
        </div>
      {/each}
    </div>

    {#if visibleEntries.length === 0}
      <div class="logs-empty">
        {$t('logs.empty', { default: 'No log entries yet.' })}
      </div>
    {:else}
      {#each visibleEntries as entry (entry.id)}
        <div class="logs-row level-{entry.level}">
          <span class="logs-cell logs-time">{formatTime(entry.timestamp)}</span>
          <span class="logs-cell logs-level">{entry.level}</span>
          <span class="logs-cell logs-source">{entry.source}</span>
          <span class="logs-cell logs-window" title={entry.window}>{entry.window}</span>
          <span class="logs-cell logs-message" title={entry.message}>{entry.message}</span>
          <span class="logs-cell logs-details" title={entry.details}>{entry.details}</span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<svelte:window onpointermove={handleWindowPointerMove} onpointerup={handleWindowPointerUp} />
