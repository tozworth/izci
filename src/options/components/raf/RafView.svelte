<script lang="ts">
  import { onDestroy } from 'svelte';
  import { RAF_EFFECT_DEFINITIONS } from '$lib/services/raf-effect-registry';
  import {
    exportRafSettingsClipboard,
    exportRafSettingsFile,
    importRafSettingsClipboard,
    importRafSettingsFile
  } from '$lib/services/raf-settings-transfer';
  import { rafSettings } from '$lib/stores/raf-settings';
  import { rafMeter } from '$lib/services/raf-meter';
  import RafEffectCard from './RafEffectCard.svelte';

  let draggedId: string | null = null;
  let dropBoundary: number | null = null;
  let dragEngaged = false;
  let transferMenu: HTMLDetailsElement;
  let fileInput: HTMLInputElement;
  let transferStatus = '';
  let transferFailed = false;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  onDestroy(() => {
    if (statusTimer) clearTimeout(statusTimer);
  });

  function closeTransferMenu() {
    transferMenu?.removeAttribute('open');
  }

  function showTransferStatus(message: string, failed = false) {
    transferStatus = message;
    transferFailed = failed;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      transferStatus = '';
      transferFailed = false;
    }, 4000);
  }

  async function runTransfer(action: () => unknown | Promise<unknown>, successMessage: string) {
    closeTransferMenu();
    try {
      await action();
      showTransferStatus(successMessage);
    } catch (error) {
      showTransferStatus(error instanceof Error ? error.message : 'Raf settings transfer failed.', true);
    }
  }

  async function handleFileImport(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await runTransfer(() => importRafSettingsFile(file), 'Rack imported');
  }

  function updateDropBoundary(event: DragEvent, index: number) {
    event.preventDefault();
    if (!draggedId) return;
    dragEngaged = true;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropBoundary = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }

  function dropEffect(event: DragEvent) {
    event.preventDefault();
    if (draggedId && dropBoundary !== null) {
      const sourceIndex = $rafSettings.effects.findIndex((effect) => effect.id === draggedId);
      const targetIndex = dropBoundary > sourceIndex ? dropBoundary - 1 : dropBoundary;
      rafSettings.moveEffect(draggedId, targetIndex);
    }
    clearDrag();
  }

  function clearDrag() {
    draggedId = null;
    dropBoundary = null;
    dragEngaged = false;
  }

  function formatDb(value: number) {
    return value <= -60 ? '-∞' : value.toFixed(1);
  }
</script>

<article class="raf-view">
  <div class="raf-toolbar" aria-label="Raf controls">
    <button class:active={$rafSettings.enabled} on:click={() => rafSettings.setEnabled(!$rafSettings.enabled)} title={$rafSettings.enabled ? 'Bypass Raf' : 'Power on Raf'} aria-label={$rafSettings.enabled ? 'Bypass Raf' : 'Power on Raf'} aria-pressed={$rafSettings.enabled}>
      <span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span>
    </button>
    <details class="add-menu">
      <summary title="Add effect" aria-label="Add effect"><span class="material-symbols-outlined" aria-hidden="true">add</span></summary>
      <div class="add-menu-items">
        {#each RAF_EFFECT_DEFINITIONS as definition}
          <button on:click={(event) => { rafSettings.addEffect(definition.type); (event.currentTarget.closest('details') as HTMLDetailsElement)?.removeAttribute('open'); }}>
            <span class="material-symbols-outlined" aria-hidden="true">{definition.icon}</span>{definition.name}
          </button>
        {/each}
      </div>
    </details>
    <details class="transfer-menu" bind:this={transferMenu}>
      <summary title="Import or export rack settings" aria-label="Import or export rack settings"><span class="material-symbols-outlined" aria-hidden="true">import_export</span></summary>
      <div class="transfer-menu-items">
        <button on:click={() => runTransfer(() => importRafSettingsClipboard(), 'Rack imported')}>
          <span class="material-symbols-outlined" aria-hidden="true">content_paste</span>Import from clipboard
        </button>
        <button on:click={() => { closeTransferMenu(); fileInput.click(); }}>
          <span class="material-symbols-outlined" aria-hidden="true">file_open</span>Import JSON
        </button>
        <button title="Copy rack settings to the clipboard" on:click={() => runTransfer(() => exportRafSettingsClipboard(), 'Rack copied')}>
          <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>Export to clipboard
        </button>
        <button on:click={() => runTransfer(() => exportRafSettingsFile(), 'Rack exported')}>
          <span class="material-symbols-outlined" aria-hidden="true">download</span>Export JSON
        </button>
      </div>
    </details>
    <input bind:this={fileInput} class="file-input" type="file" accept="application/json,.json" on:change={handleFileImport} />
    <button on:click={() => rafSettings.clearEffects()} disabled={$rafSettings.effects.length === 0} title="Remove all effects" aria-label="Remove all effects">
      <span class="material-symbols-outlined" aria-hidden="true">delete</span>
    </button>
    {#if transferStatus}
      <span class:failed={transferFailed} class="transfer-status" role="status">{transferStatus}</span>
    {/if}
    <div class="meter-readouts" aria-label="Raf input and output peak levels">
      <span title="Raf input peak">IN {formatDb($rafMeter.inputDb)} dB</span>
      <span title="Raf output peak">OUT {formatDb($rafMeter.outputDb)} dB</span>
    </div>
    <span class:clipping={$rafMeter.clipping} class="clip-warning" title={$rafMeter.clipping ? "Help me, I'm clipping!" : 'No clipping detected'} aria-label={$rafMeter.clipping ? "Help me, I'm clipping!" : 'No clipping detected'}>!</span>
  </div>

  {#if $rafSettings.effects.length === 0}
    <div class="empty-rack">
      <span class="material-symbols-outlined" aria-hidden="true">audio_file</span>
      <strong>The rack is empty</strong>
    </div>
  {:else}
    <div class="effect-list" role="list" class:is-bypassed={!$rafSettings.enabled} class:is-dragging={draggedId !== null} on:dragend={clearDrag} on:drop={dropEffect}>
      {#each $rafSettings.effects as effect, index (effect.id)}
        <div
          class="effect-slot"
          role="listitem"
          class:show-drop-line={draggedId !== null && dropBoundary === index}
          on:dragover={(event) => updateDropBoundary(event, index)}
        >
          <RafEffectCard
            {effect}
            {index}
            total={$rafSettings.effects.length}
            isDragging={dragEngaged && draggedId === effect.id}
            onDragStart={(id) => {
              draggedId = id;
              dropBoundary = index;
            }}
            onDragEnd={clearDrag}
          />
        </div>
      {/each}
      <div
        class="drop-tail"
        class:show-drop-line={draggedId !== null && dropBoundary === $rafSettings.effects.length}
        on:dragover={(event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          dragEngaged = true;
          dropBoundary = $rafSettings.effects.length;
        }}
        aria-hidden="true"
      ></div>
    </div>
  {/if}
</article>

<style>
  .raf-view { width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 6px; }
  .raf-toolbar { position: relative; width: 100%; min-width: 0; min-height: 29px; display: flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--border-faint); border-radius: 5px; background: var(--bg-card); }
  .raf-toolbar > button,
  .add-menu summary,
  .transfer-menu summary { width: 27px; height: 27px; padding: 0; display: grid; place-items: center; border-radius: 4px; background: transparent; color: var(--muted-strong); cursor: pointer; }
  .raf-toolbar > button:hover:not(:disabled),
  .add-menu summary:hover,
  .transfer-menu summary:hover { background: var(--hover-surface); color: var(--text-strong); }
  .raf-toolbar > button.active { color: var(--accent-strong); }
  .raf-toolbar > button:disabled { opacity: 0.35; cursor: default; }
  .meter-readouts { margin-left: auto; display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 9px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .clip-warning { width: 17px; height: 17px; display: grid; place-items: center; border: 1px solid var(--border-faint); border-radius: 50%; color: var(--muted); font-size: 11px; font-weight: 800; opacity: 0.35; }
  .clip-warning.clipping { border-color: #ff604f; background: #ff604f; color: #fff; opacity: 1; box-shadow: 0 0 7px rgb(255 72 52 / 55%); }
  .add-menu,
  .transfer-menu { position: static; }
  .add-menu summary,
  .transfer-menu summary { list-style: none; }
  .add-menu summary::-webkit-details-marker,
  .transfer-menu summary::-webkit-details-marker { display: none; }
  .add-menu-items,
  .transfer-menu-items { position: absolute; z-index: 5; left: 2px; right: auto; top: calc(100% + 3px); width: min(190px, calc(100% - 4px)); min-width: 0; padding: 3px; display: grid; border: 1px solid var(--menu-bar-border); border-radius: 5px; background: var(--menu-popover-bg); box-shadow: 0 6px 16px rgb(0 0 0 / 35%); }
  .add-menu-items { width: min(148px, calc(100% - 4px)); }
  .transfer-menu-items button,
  .add-menu-items button { display: flex; align-items: center; gap: 6px; padding: 6px 7px; border-radius: 3px; background: transparent; color: var(--text); text-align: left; }
  .transfer-menu-items button:hover,
  .add-menu-items button:hover { background: var(--hover-surface); color: var(--text-strong); }
  .file-input { display: none; }
  .transfer-status { min-width: 0; overflow: hidden; color: var(--accent-strong); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .transfer-status.failed { color: #ff786a; }
  .effect-list { width: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 5px; transition: opacity 120ms ease; }
  .effect-list.is-dragging { cursor: grabbing; }
  .effect-list.is-bypassed { opacity: 0.72; }
  .effect-slot,
  .drop-tail { position: relative; min-width: 0; }
  .effect-slot.show-drop-line::before,
  .drop-tail.show-drop-line::before { content: ''; position: absolute; z-index: 4; left: 2px; right: 2px; top: -4px; height: 3px; border-radius: 1px; background: var(--accent-strong); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-strong) 35%, transparent); pointer-events: none; }
  .drop-tail { flex: 1 0 64px; min-height: 64px; }
  .empty-rack { min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 14px; color: var(--muted); text-align: center; }
  .empty-rack > .material-symbols-outlined { font-size: 26px; color: var(--accent-strong); }
  .empty-rack strong { color: var(--text-strong); }
</style>
