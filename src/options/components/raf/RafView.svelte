<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    exportRafSettingsClipboard,
    exportRafSettingsFile,
    importRafSettingsClipboard,
    importRafSettingsFile
  } from '$lib/services/raf-settings-transfer';
  import { rafSettings } from '$lib/stores/raf-settings';
  import { isRafPresetDirty, rafPresets } from '$lib/stores/raf-presets';
  import { rafMeter } from '$lib/services/raf-meter';
  import RafEffectsWorkspace from './RafEffectsWorkspace.svelte';

  let transferMenu: HTMLDetailsElement;
  let presetMenu: HTMLDetailsElement;
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

  function formatDb(value: number) {
    return value <= -60 ? '-∞' : value.toFixed(1);
  }

  function closePresetMenu() {
    presetMenu?.removeAttribute('open');
  }

  function createPreset() {
    const name = window.prompt('Name this Raf preset:');
    if (name === null) return;
    if (rafPresets.create(name)) closePresetMenu();
  }

  function renamePreset(id: string, currentName: string) {
    const name = window.prompt('Rename Raf preset:', currentName);
    if (name !== null) rafPresets.rename(id, name);
  }

  function selectPreset(id: string) {
    rafPresets.apply(id);
    closePresetMenu();
  }

  $: selectedPreset = $rafPresets.presets.find((preset) => preset.id === $rafPresets.selectedPresetId) ?? null;
  $: presetDirty = isRafPresetDirty($rafPresets, $rafSettings);
</script>

<article class="raf-view">
  <div class="raf-toolbar" aria-label="Raf controls">
    <button class:active={$rafSettings.enabled} on:click={() => rafSettings.setEnabled(!$rafSettings.enabled)} title={$rafSettings.enabled ? 'Bypass Raf' : 'Power on Raf'} aria-label={$rafSettings.enabled ? 'Bypass Raf' : 'Power on Raf'} aria-pressed={$rafSettings.enabled}>
      <span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span>
    </button>
    <details class="preset-menu" bind:this={presetMenu}>
      <summary title="Choose a Raf preset" aria-label="Choose a Raf preset">
        <span class="preset-summary-name">{selectedPreset?.name ?? 'Presets'}{presetDirty ? ' *' : ''}</span>
        <span class="material-symbols-outlined" aria-hidden="true">arrow_drop_down</span>
      </summary>
      <div class="preset-menu-items">
        <button class="new-preset" on:click={createPreset}>
          <span class="material-symbols-outlined" aria-hidden="true">add</span>New preset
        </button>
        {#if $rafPresets.presets.length > 0}
          <div class="preset-separator" aria-hidden="true"></div>
          {#each $rafPresets.presets as preset (preset.id)}
            <div class="preset-entry" class:selected={preset.id === $rafPresets.selectedPresetId}>
              <button class="preset-select" on:click={() => selectPreset(preset.id)} title={`Apply ${preset.name}`}>
                <span class="material-symbols-outlined preset-check" aria-hidden="true">check</span>
                <span>{preset.name}</span>
              </button>
              <div class="preset-entry-actions">
                <button on:click={() => renamePreset(preset.id, preset.name)} title={`Rename ${preset.name}`} aria-label={`Rename ${preset.name}`}>
                  <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                </button>
                <button on:click={() => rafPresets.delete(preset.id)} title={`Delete ${preset.name}`} aria-label={`Delete ${preset.name}`}>
                  <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </details>
    <button class="save-preset" on:click={() => rafPresets.save()} disabled={!presetDirty} title="Save changes to preset" aria-label="Save changes to preset">
      <span class="material-symbols-outlined" aria-hidden="true">save</span>
    </button>
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
    {#if transferStatus}
      <span class:failed={transferFailed} class="transfer-status" role="status">{transferStatus}</span>
    {/if}
    <div class="meter-readouts" aria-label="Raf input and output peak levels">
      <span title="Raf input peak">IN {formatDb($rafMeter.inputDb)} dB</span>
      <span title="Raf output peak">OUT {formatDb($rafMeter.outputDb)} dB</span>
    </div>
    <span class:clipping={$rafMeter.clipping} class="clip-warning" title={$rafMeter.clipping ? "Help me, I'm clipping!" : 'No clipping detected'} aria-label={$rafMeter.clipping ? "Help me, I'm clipping!" : 'No clipping detected'}>!</span>
  </div>

  <RafEffectsWorkspace />
</article>

<style>
  .raf-view { width: 100%; height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
  .raf-toolbar {
    position: sticky;
    z-index: 10;
    top: 0;
    width: 100%;
    min-width: 0;
    min-height: 32px;
    margin: 0;
    padding: 2px 10px;
    display: flex;
    align-items: center;
    gap: 2px;
    border-bottom: 1px solid var(--border-soft);
    background: color-mix(in srgb, var(--window-topbar-bg) 94%, transparent);
    backdrop-filter: blur(16px) saturate(1.08);
    -webkit-backdrop-filter: blur(16px) saturate(1.08);
    box-shadow: 0 1px 0 var(--hairline), 0 8px 16px rgb(0 0 0 / 8%);
  }
  .raf-toolbar > button,
  .transfer-menu summary { width: 27px; height: 27px; padding: 0; display: grid; place-items: center; border-radius: 4px; background: transparent; color: var(--muted-strong); }
  .raf-toolbar > button:hover:not(:disabled),
  .transfer-menu summary:hover { background: var(--hover-surface); color: var(--text-strong); }
  .raf-toolbar > button.active { color: var(--accent-strong); }
  .raf-toolbar > button:disabled { opacity: 0.35; cursor: default; }
  .meter-readouts { margin-left: auto; display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 9px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .clip-warning { width: 17px; height: 17px; display: grid; place-items: center; border: 1px solid var(--border-faint); border-radius: 50%; color: var(--muted); font-size: 11px; font-weight: 800; opacity: 0.35; }
  .clip-warning.clipping { border-color: #ff604f; background: #ff604f; color: #fff; opacity: 1; box-shadow: 0 0 7px rgb(255 72 52 / 55%); }
  .transfer-menu,
  .preset-menu { position: static; }
  .transfer-menu summary { list-style: none; }
  .transfer-menu summary::-webkit-details-marker { display: none; }
  .preset-menu summary { width: min(150px, 32vw); height: 27px; min-width: 72px; padding: 0 4px 0 7px; display: flex; align-items: center; gap: 2px; border-radius: 4px; background: var(--bg-input); color: var(--text); list-style: none; }
  .preset-menu summary:hover { background: var(--hover-surface); color: var(--text-strong); }
  .preset-menu summary::-webkit-details-marker { display: none; }
  .preset-summary-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preset-menu-items { position: absolute; z-index: 6; left: 60px; top: calc(100% + 3px); width: min(250px, calc(100% - 64px)); min-width: 160px; padding: 3px; display: grid; border: 1px solid var(--menu-bar-border); border-radius: 5px; background: var(--menu-popover-bg); box-shadow: 0 6px 16px rgb(0 0 0 / 35%); }
  .preset-menu-items > .new-preset { display: flex; align-items: center; gap: 6px; padding: 6px 7px; border-radius: 3px; background: transparent; color: var(--text); text-align: left; }
  .preset-menu-items > .new-preset:hover { background: var(--hover-surface); color: var(--text-strong); }
  .preset-separator { height: 1px; margin: 3px 4px; background: var(--border-soft); }
  .preset-entry { min-width: 0; display: flex; align-items: center; border-radius: 3px; }
  .preset-entry:hover,
  .preset-entry:focus-within { background: var(--hover-surface); }
  .preset-select { min-width: 0; flex: 1; display: flex; align-items: center; gap: 5px; padding: 6px 5px; overflow: hidden; background: transparent; color: var(--text); text-align: left; }
  .preset-select > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preset-check { visibility: hidden; flex: 0 0 auto; color: var(--accent-strong); }
  .preset-entry.selected .preset-check { visibility: visible; }
  .preset-entry-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 1px; padding-right: 3px; opacity: 0; pointer-events: none; }
  .preset-entry:hover .preset-entry-actions,
  .preset-entry:focus-within .preset-entry-actions { opacity: 1; pointer-events: auto; }
  .preset-entry-actions button { width: 24px; height: 24px; padding: 0; display: grid; place-items: center; border-radius: 3px; background: transparent; color: var(--muted); }
  .preset-entry-actions button:hover { background: var(--active-surface); color: var(--text-strong); }
  .transfer-menu-items { position: absolute; z-index: 5; left: 2px; right: auto; top: calc(100% + 3px); width: min(190px, calc(100% - 4px)); min-width: 0; padding: 3px; display: grid; border: 1px solid var(--menu-bar-border); border-radius: 5px; background: var(--menu-popover-bg); box-shadow: 0 6px 16px rgb(0 0 0 / 35%); }
  .transfer-menu-items button { display: flex; align-items: center; gap: 6px; padding: 6px 7px; border-radius: 3px; background: transparent; color: var(--text); text-align: left; }
  .transfer-menu-items button:hover { background: var(--hover-surface); color: var(--text-strong); }
  .file-input { display: none; }
  .transfer-status { min-width: 0; overflow: hidden; color: var(--accent-strong); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .transfer-status.failed { color: #ff786a; }
</style>
