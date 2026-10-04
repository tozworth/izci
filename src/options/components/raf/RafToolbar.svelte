<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    exportRafSettingsClipboard,
    exportRafSettingsFile,
    importRafSettingsClipboard,
    importRafSettingsFile,
    RafSettingsTransferError
  } from '$lib/services/raf-settings-transfer';
  import { rafSettings } from '$lib/stores/raf-settings';
  import { isRafPresetDirty, rafPresets } from '$lib/stores/raf-presets';
  import { rafMeter } from '$lib/services/raf-meter';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { LOADOUT_COLORS } from '$lib/stores/loadouts';
  import { getLoadoutColorValue, LOADOUT_COLOR_VALUES } from '$lib/utils/loadout-presentation';
  import type { MenuActionItem } from '$lib/types';
  import { normalizePresetIcon } from '$lib/utils/preset-icons';

  let transferMenu: HTMLDetailsElement;
  let presetMenuOpen = false;
  let appearancePresetId: string | null = null;
  let appearanceMenuX = 0;
  let appearanceMenuY = 0;
  let presetMenuX = 0;
  let presetMenuY = 0;
  let presetMenuDismissedAt = 0;
  let presetTriggerElement: HTMLButtonElement | null = null;
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

  function localizeTransferError(error: unknown): string {
    if (!(error instanceof RafSettingsTransferError)) {
      return $t('options.raf.transfer.failed', { default: 'Raf settings transfer failed.' });
    }

    switch (error.code) {
      case 'invalid-json':
        return $t('options.raf.transfer.errors.invalidJson', {
          default: 'The selected content is not valid JSON.'
        });
      case 'invalid-rack':
        return $t('options.raf.transfer.errors.invalidRack', {
          default: 'The JSON does not contain valid Raf rack settings.'
        });
      case 'invalid-effect':
        return $t('options.raf.transfer.errors.invalidEffect', {
          default: 'The Raf rack contains an unsupported or malformed effect.'
        });
      case 'clipboard-unavailable':
        return $t('options.raf.transfer.errors.clipboardUnavailable', {
          default: 'Clipboard access is unavailable.'
        });
    }
  }

  async function runTransfer(action: () => unknown | Promise<unknown>, successMessage: string) {
    closeTransferMenu();
    try {
      await action();
      showTransferStatus(successMessage);
    } catch (error) {
      showTransferStatus(localizeTransferError(error), true);
    }
  }

  async function handleFileImport(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await runTransfer(() => importRafSettingsFile(file), $t('options.raf.transfer.imported', { default: 'Rack imported' }));
  }

  function formatDb(value: number) {
    return value <= -60 ? '-∞' : value.toFixed(1);
  }

  function closePresetMenu() {
    presetMenuOpen = false;
    appearancePresetId = null;
    presetMenuDismissedAt = performance.now();
  }

  function openPresetMenu(event: MouseEvent) {
    // Pointerdown on the trigger dismisses the open menu first (windowDismiss);
    // swallow the follow-up click so the trigger toggles without reopening.
    if (presetMenuOpen || performance.now() - presetMenuDismissedAt < 150) {
      closePresetMenu();
      return;
    }
    const anchor = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
    presetMenuX = anchor.left;
    presetMenuY = anchor.bottom + 4;
    presetMenuOpen = true;
  }

  function createPreset() {
    const name = window.prompt($t('options.raf.presets.namePrompt', { default: 'Name this Raf preset:' }));
    if (name === null) return;
    if (rafPresets.create(name)) closePresetMenu();
  }

  function renamePreset(id: string, currentName: string) {
    const name = window.prompt($t('options.raf.presets.renamePrompt', { default: 'Rename Raf preset:' }), currentName);
    if (name !== null) rafPresets.rename(id, name);
  }

  function openPresetAppearance(event: CustomEvent<{ id: string; x: number; y: number }>) {
    appearancePresetId = event.detail.id;
    appearanceMenuX = event.detail.x;
    appearanceMenuY = event.detail.y;
  }

  $: colorLabels = {
    white: $t('options.loadouts.colors.white', { default: 'White' }),
    red: $t('options.loadouts.colors.red', { default: 'Red' }),
    orange: $t('options.loadouts.colors.orange', { default: 'Orange' }),
    amber: $t('options.loadouts.colors.amber', { default: 'Amber' }),
    lime: $t('options.loadouts.colors.lime', { default: 'Lime' }),
    green: $t('options.loadouts.colors.green', { default: 'Green' }),
    teal: $t('options.loadouts.colors.teal', { default: 'Teal' }),
    cyan: $t('options.loadouts.colors.cyan', { default: 'Cyan' }),
    blue: $t('options.loadouts.colors.blue', { default: 'Blue' }),
    indigo: $t('options.loadouts.colors.indigo', { default: 'Indigo' }),
    violet: $t('options.loadouts.colors.violet', { default: 'Violet' }),
    magenta: $t('options.loadouts.colors.magenta', { default: 'Magenta' })
  };

  $: selectedPreset = $rafPresets.presets.find((preset) => preset.id === $rafPresets.selectedPresetId) ?? null;
  $: presetDirty = isRafPresetDirty($rafPresets, $rafSettings);
  $: appearancePreset = $rafPresets.presets.find((preset) => preset.id === appearancePresetId);
  $: appearanceMenuItems = [{
    id: 'icon',
    label: $t('options.presetIcons.setIcon', { default: 'Set icon' }),
    icon: appearancePreset?.icon ?? 'tune',
    iconPicker: {
      value: appearancePreset?.icon,
      defaultIcon: 'tune',
      actionPrefix: 'icon:',
      color: getLoadoutColorValue(appearancePreset?.color)
    }
  }, {
    id: 'color',
    label: $t('options.raf.presets.setColor', { default: 'Set color' }),
    icon: 'palette',
    colorPicker: LOADOUT_COLORS.map((color) => ({
      id: `color:${color}`,
      label: colorLabels[color],
      color: LOADOUT_COLOR_VALUES[color],
      checked: appearancePreset?.color === color
    }))
  }] satisfies MenuActionItem[];
  $: presetMenuItems = [
    {
      id: 'new',
      label: $t('options.raf.presets.new', { default: 'New preset' }),
      icon: 'add'
    },
    ...$rafPresets.presets.map((preset, index) => ({
      id: `apply:${preset.id}`,
      icon: preset.icon ?? 'tune',
      iconColor: getLoadoutColorValue(preset.color),
      contextActionId: preset.id,
      label: `${preset.name}${preset.id === $rafPresets.selectedPresetId && presetDirty ? ' *' : ''}`,
      checked: preset.id === $rafPresets.selectedPresetId,
      separatorBefore: index === 0,
      editActionId: `rename:${preset.id}`,
      editLabel: $t('options.raf.presets.rename', { default: 'Rename {preset}', values: { preset: preset.name } }),
      removeActionId: `delete:${preset.id}`,
      removeLabel: $t('options.raf.presets.delete', { default: 'Delete {preset}', values: { preset: preset.name } }),
      removeIcon: 'delete'
    }))
  ];

  function handlePresetAppearanceAction(actionId: string) {
    if (appearancePresetId) {
      if (actionId.startsWith('icon:')) {
        const value = actionId.slice('icon:'.length);
        const icon = normalizePresetIcon(value);
        if (icon || value === 'default') rafPresets.setIcon(appearancePresetId, icon);
        return;
      }
      const color = LOADOUT_COLORS.find((candidate) => actionId === `color:${candidate}`);
      if (color && appearancePreset) rafPresets.setColor(appearancePresetId, appearancePreset.color === color ? undefined : color);
      return;
    }
  }

  function handlePresetMenuAction(actionId: string) {
    appearancePresetId = null;
    if (actionId === 'new') {
      createPreset();
      return;
    }
    if (actionId.startsWith('rename:')) {
      closePresetMenu();
      const preset = $rafPresets.presets.find((candidate) => candidate.id === actionId.slice('rename:'.length));
      if (preset) renamePreset(preset.id, preset.name);
      return;
    }
    if (actionId.startsWith('apply:')) {
      rafPresets.apply(actionId.slice('apply:'.length));
      closePresetMenu();
      return;
    }
    if (actionId.startsWith('delete:')) {
      const preset = $rafPresets.presets.find((candidate) => candidate.id === actionId.slice('delete:'.length));
      if (!preset) return;
      const confirmed = window.confirm($t('options.raf.presets.confirmDelete', {
        default: 'Delete Raf preset “{preset}”? This cannot be undone.',
        values: { preset: preset.name }
      }));
      if (confirmed) rafPresets.delete(preset.id);
    }
  }
</script>

<div class="raf-toolbar" aria-label={$t('options.raf.controls', { default: 'Raf controls' })}>
  <button class="hover-tooltip-anchor" class:active={$rafSettings.enabled} on:click={() => rafSettings.setEnabled(!$rafSettings.enabled)} aria-label={$rafSettings.enabled ? $t('options.raf.bypass', { default: 'Bypass Raf' }) : $t('options.raf.powerOn', { default: 'Power on Raf' })} aria-pressed={$rafSettings.enabled}>
    <span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span>
    <HoverTooltip>{$rafSettings.enabled ? $t('options.raf.bypass', { default: 'Bypass Raf' }) : $t('options.raf.powerOn', { default: 'Power on Raf' })}</HoverTooltip>
  </button>
  <button
    bind:this={presetTriggerElement}
    type="button"
    class="preset-trigger hover-tooltip-anchor"
    on:click={openPresetMenu}
    aria-label={$t('options.raf.presets.choose', { default: 'Choose a Raf preset' })}
    aria-haspopup="menu"
    aria-expanded={presetMenuOpen}
  >
    {#if selectedPreset}
      <span class="material-symbols-outlined preset-icon" style:color={getLoadoutColorValue(selectedPreset.color)} aria-hidden="true">{selectedPreset.icon ?? 'tune'}</span>
    {/if}
    <span class="preset-summary-name">{selectedPreset?.name ?? $t('options.raf.presets.label', { default: 'Presets' })}{presetDirty ? ' *' : ''}</span>
    <span class="material-symbols-outlined" aria-hidden="true">arrow_drop_down</span>
    <HoverTooltip>{$t('options.raf.presets.choose', { default: 'Choose a Raf preset' })}</HoverTooltip>
  </button>
  <button class="save-preset hover-tooltip-anchor" on:click={() => rafPresets.save()} disabled={!presetDirty} aria-label={$t('options.raf.presets.save', { default: 'Save changes to preset' })}>
    <span class="material-symbols-outlined" aria-hidden="true">save</span>
    <HoverTooltip>{$t('options.raf.presets.save', { default: 'Save changes to preset' })}</HoverTooltip>
  </button>
  <details class="transfer-menu" bind:this={transferMenu}>
    <summary class="hover-tooltip-anchor" aria-label={$t('options.raf.transfer.label', { default: 'Import or export rack settings' })}><span class="material-symbols-outlined" aria-hidden="true">import_export</span><HoverTooltip>{$t('options.raf.transfer.label', { default: 'Import or export rack settings' })}</HoverTooltip></summary>
    <div class="transfer-menu-items">
      <button on:click={() => runTransfer(() => importRafSettingsClipboard(), $t('options.raf.transfer.imported', { default: 'Rack imported' }))}>
        <span class="material-symbols-outlined" aria-hidden="true">content_paste</span>{$t('options.raf.transfer.importClipboard', { default: 'Import from clipboard' })}
      </button>
      <button on:click={() => { closeTransferMenu(); fileInput.click(); }}>
        <span class="material-symbols-outlined" aria-hidden="true">file_open</span>{$t('options.raf.transfer.importJson', { default: 'Import JSON' })}
      </button>
      <button class="hover-tooltip-anchor" on:click={() => runTransfer(() => exportRafSettingsClipboard(), $t('options.raf.transfer.copied', { default: 'Rack copied' }))}>
        <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>{$t('options.raf.transfer.exportClipboard', { default: 'Export to clipboard' })}
        <HoverTooltip>{$t('options.raf.transfer.copyHint', { default: 'Copy rack settings to the clipboard' })}</HoverTooltip>
      </button>
      <button on:click={() => runTransfer(() => exportRafSettingsFile(), $t('options.raf.transfer.exported', { default: 'Rack exported' }))}>
        <span class="material-symbols-outlined" aria-hidden="true">download</span>{$t('options.raf.transfer.exportJson', { default: 'Export JSON' })}
      </button>
    </div>
  </details>
  <input bind:this={fileInput} class="file-input" type="file" accept="application/json,.json" on:change={handleFileImport} />
  {#if transferStatus}
    <span class:failed={transferFailed} class="transfer-status" role="status">{transferStatus}</span>
  {/if}
  <div class="meter-readouts" aria-label={$t('options.raf.meter.levels', { default: 'Raf input and output peak levels' })}>
    <span class="hover-tooltip-anchor">{$t('options.raf.meter.inputAbbreviation', { default: 'IN' })} {formatDb($rafMeter.inputDb)} dB<HoverTooltip>{$t('options.raf.meter.inputPeak', { default: 'Raf input peak' })}</HoverTooltip></span>
    <span class="hover-tooltip-anchor">{$t('options.raf.meter.outputAbbreviation', { default: 'OUT' })} {formatDb($rafMeter.outputDb)} dB<HoverTooltip>{$t('options.raf.meter.outputPeak', { default: 'Raf output peak' })}</HoverTooltip></span>
  </div>
  <span class:clipping={$rafMeter.clipping} class="clip-warning hover-tooltip-anchor" aria-label={$rafMeter.clipping ? $t('options.raf.meter.clipping', { default: "Help me, I'm clipping!" }) : $t('options.raf.meter.noClipping', { default: 'No clipping detected' })}>!<HoverTooltip>{$rafMeter.clipping ? $t('options.raf.meter.clipping', { default: "Help me, I'm clipping!" }) : $t('options.raf.meter.noClipping', { default: 'No clipping detected' })}</HoverTooltip></span>
</div>

{#if presetMenuOpen}
  <MenuSurface
    items={presetMenuItems}
    x={presetMenuX}
    y={presetMenuY}
    enableOverflowSubmenuFallback
    ariaLabel={$t('options.raf.presets.choose', { default: 'Choose a Raf preset' })}
    on:action={(event) => handlePresetMenuAction(event.detail)}
    on:contextaction={openPresetAppearance}
    on:dismiss={closePresetMenu}
  >
    {#if appearancePresetId}
      <div class="preset-appearance-menu" style:left={`${appearanceMenuX}px`} style:top={`${appearanceMenuY}px`}>
        <MenuSurface
          nested
          items={appearanceMenuItems}
          ariaLabel={appearancePreset?.name}
          on:action={(event) => handlePresetAppearanceAction(event.detail)}
          on:dismiss={() => appearancePresetId = null}
        />
      </div>
    {/if}
  </MenuSurface>
{/if}

<style>
  .preset-appearance-menu { position: fixed; width: 0; z-index: 1; }
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
  .raf-toolbar > button:not(.preset-trigger),
  .transfer-menu summary { width: 27px; height: 27px; padding: 0; display: grid; place-items: center; border-radius: 4px; background: transparent; color: var(--muted-strong); }
  .raf-toolbar > button:hover:not(:disabled),
  .transfer-menu summary:hover { background: var(--hover-surface); color: var(--text-strong); }
  .raf-toolbar > button.active { color: var(--accent-strong); }
  .raf-toolbar > button:disabled { opacity: 0.35; cursor: default; }
  .meter-readouts { margin-left: auto; display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 9px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .clip-warning { width: 17px; height: 17px; display: grid; place-items: center; border: 1px solid var(--border-faint); border-radius: 50%; color: var(--muted); font-size: 11px; font-weight: 800; opacity: 0.35; }
  .clip-warning.clipping { border-color: #ff604f; background: #ff604f; color: #fff; opacity: 1; box-shadow: 0 0 7px rgb(255 72 52 / 55%); }
  .transfer-menu,
  .preset-trigger { position: static; }
  .transfer-menu summary { list-style: none; }
  .transfer-menu summary::-webkit-details-marker { display: none; }
  .preset-trigger { width: min(150px, 32vw); height: 27px; min-width: 72px; padding: 0 4px 0 7px; display: flex; align-items: center; gap: 2px; border-radius: 4px; background: var(--bg-input); color: var(--text); font-size: inherit; }
  .preset-trigger:hover { background: var(--hover-surface); color: var(--text-strong); }
  .preset-summary-name { min-width: 0; flex: 1; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
  .preset-icon { flex: 0 0 auto; margin-right: 3px; font-size: 1rem; }
  .transfer-menu-items { position: absolute; z-index: 5; left: 2px; right: auto; top: calc(100% + 3px); width: min(190px, calc(100% - 4px)); min-width: 0; padding: 3px; display: grid; border: 1px solid var(--menu-bar-border); border-radius: 5px; background: var(--menu-popover-bg); box-shadow: 0 6px 16px rgb(0 0 0 / 35%); }
  .transfer-menu-items button { display: flex; align-items: center; gap: 6px; padding: 6px 7px; border-radius: 3px; background: transparent; color: var(--text); text-align: left; }
  .transfer-menu-items button:hover { background: var(--hover-surface); color: var(--text-strong); }
  .file-input { display: none; }
  .transfer-status { min-width: 0; overflow: hidden; color: var(--accent-strong); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .transfer-status.failed { color: #ff786a; }
</style>
