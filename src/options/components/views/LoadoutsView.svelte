<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import { filesystemFolders } from '$lib/services/filesystem-folders';
  import { loadoutTrackContext } from '$lib/services/loadout-track-context';
  import {
    LOADOUT_CATEGORIES,
    applyLoadoutSettings,
    canCaptureLoadoutCategories,
    captureLoadoutSettings,
    createLoadoutTarget,
    getLoadoutCategories,
    isValidLoadoutPattern
  } from '$lib/services/loadouts';
  import { loadoutUiSettings } from '$lib/stores/loadout-ui-settings';
  import { loadouts } from '$lib/stores/loadouts';
  import { rafPresets } from '$lib/stores/raf-presets';
  import type { Loadout, LoadoutCategory, LoadoutType } from '$lib/types';
  import OptionGlyphButton from '../OptionGlyphButton.svelte';

  const LOADOUT_TYPES: LoadoutType[] = ['file', 'path', 'type', 'tags', 'preset'];
  const CATEGORY_ICONS: Record<LoadoutCategory, string> = {
    playback: 'play_circle',
    raf: 'tune',
    modules: 'memory',
    appearance: 'palette'
  };
  const TYPE_ICONS: Record<LoadoutType, string> = {
    file: 'audio_file',
    path: 'folder',
    type: 'extension',
    tags: 'tag',
    preset: 'bookmark'
  };

  let loadoutType: LoadoutType = 'file';
  let manualText = '';
  let selectedCategories = new Set<LoadoutCategory>();

  function typeLabel(type: LoadoutType): string {
    if (type === 'file') return $t('options.loadouts.types.file', { default: 'File' });
    if (type === 'path') return $t('options.loadouts.types.path', { default: 'Folder' });
    if (type === 'type') return $t('options.loadouts.types.type', { default: 'Type' });
    if (type === 'tags') return $t('options.loadouts.types.tags', { default: 'Tags' });
    return $t('options.loadouts.types.preset', { default: 'Preset' });
  }

  function categoryLabel(category: LoadoutCategory): string {
    if (category === 'playback') return $t('options.loadouts.categories.playback', { default: 'Playback' });
    if (category === 'raf') return $t('options.loadouts.categories.raf', { default: 'Raf preset' });
    if (category === 'modules') return $t('options.loadouts.categories.modules', { default: 'Modules' });
    return $t('options.loadouts.categories.appearance', { default: 'Appearance' });
  }

  function toggleCategory(category: LoadoutCategory): void {
    const next = new Set(selectedCategories);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    loadoutUiSettings.update({ captureCategories: [...next] });
  }

  function handleTypeChange(event: Event): void {
    loadoutType = (event.currentTarget as HTMLSelectElement).value as LoadoutType;
    manualText = '';
  }

  function createLoadout(): void {
    const settings = captureLoadoutSettings(selectedCategories);
    if (!targetPreview || !settings) return;
    loadouts.create(targetPreview.name, targetPreview.target, settings);
    if (loadoutType === 'tags' || loadoutType === 'preset') manualText = '';
  }

  function updateLoadout(loadout: Loadout): void {
    const settings = captureLoadoutSettings(getLoadoutCategories(loadout.settings));
    if (settings) loadouts.updateSettings(loadout.id, settings);
  }

  function canUpdateLoadout(loadout: Loadout): boolean {
    return canCaptureLoadoutCategories(getLoadoutCategories(loadout.settings));
  }

  function handleCaptureKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !saveDisabled) createLoadout();
  }

  onMount(() => {
    loadoutTrackContext.request();
    void filesystemFolders.refresh();
  });

  $: rafPresetAvailable = $rafPresets.presets.some(
    (preset) => preset.id === $rafPresets.selectedPresetId
  );
  $: selectedCategories = new Set($loadoutUiSettings.captureCategories);
  $: targetPreview = createLoadoutTarget(
    loadoutType,
    $loadoutTrackContext,
    $filesystemFolders,
    manualText
  );
  $: regexInvalid = loadoutType === 'tags' && manualText.trim().length > 0 && !isValidLoadoutPattern(manualText);
  $: saveDisabled = !targetPreview || !canCaptureLoadoutCategories(selectedCategories);
  $: captureValue = loadoutType === 'tags' || loadoutType === 'preset'
    ? manualText
    : targetPreview?.name ?? '';
</script>

<article class="view">
  <section class="section">
    <div class="section-heading">
      <div>
        <h2>{$t('options.loadouts.capture.heading', { default: 'Save current settings' })}</h2>
        <p class="field-hint">{$t('options.loadouts.capture.hint', { default: 'Choose what identifies the loadout and which current settings it captures.' })}</p>
      </div>
    </div>

    <div class="capture-bar">
      <span class="capture-type-select">
        <select aria-label={$t('options.loadouts.capture.type', { default: 'Loadout type' })} value={loadoutType} on:change={handleTypeChange}>
          {#each LOADOUT_TYPES as type}
            <option value={type}>{typeLabel(type)}</option>
          {/each}
        </select>
        <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
      </span>

      <input
        class:invalid={regexInvalid}
        type="text"
        value={captureValue}
        readonly={loadoutType !== 'tags' && loadoutType !== 'preset'}
        placeholder={loadoutType === 'tags'
          ? $t('options.loadouts.capture.tagsPlaceholder', { default: 'Filename or metadata regex' })
          : loadoutType === 'preset'
            ? $t('options.loadouts.capture.presetPlaceholder', { default: 'Preset name' })
            : $t('options.loadouts.capture.noTarget', { default: 'No current target available' })}
        aria-label={$t('options.loadouts.capture.name', { default: 'Loadout name or matcher' })}
        on:input={(event) => (manualText = (event.currentTarget as HTMLInputElement).value)}
        on:keydown={handleCaptureKeydown}
      />

      <div class="category-toggles" aria-label={$t('options.loadouts.capture.categories', { default: 'Settings categories' })}>
        {#each LOADOUT_CATEGORIES as category}
          <OptionGlyphButton
            icon={CATEGORY_ICONS[category]}
            label={categoryLabel(category)}
            pressed={selectedCategories.has(category)}
            disabled={category === 'raf' && !rafPresetAvailable && !selectedCategories.has('raf')}
            on:click={() => toggleCategory(category)}
          />
        {/each}
      </div>

      <OptionGlyphButton
        icon="add"
        label={$t('options.loadouts.actions.add', { default: 'Add loadout' })}
        disabled={saveDisabled}
        on:click={createLoadout}
      />
    </div>

    {#if regexInvalid}
      <p class="capture-error">{$t('options.loadouts.capture.invalidRegex', { default: 'Enter a valid regular expression.' })}</p>
    {:else if loadoutType === 'path' && $loadoutTrackContext && !targetPreview}
      <p class="capture-note">{$t('options.loadouts.capture.noFolder', { default: 'The current file is not associated with a unique remembered FSA folder.' })}</p>
    {:else if loadoutType === 'type' && $loadoutTrackContext && !targetPreview}
      <p class="capture-note">{$t('options.loadouts.capture.noRecognizedType', { default: 'The current file does not have a recognized type yet.' })}</p>
    {/if}
  </section>

  <section class="section">
    <div class="list-heading">
      <div>
        <h2>{$t('options.loadouts.list.heading', { default: 'Loadouts' })}</h2>
        <p class="field-hint">{$t('options.loadouts.list.hint', { default: 'Load applies a saved set. Update replaces its settings from their normal Options pages.' })}</p>
      </div>
      <label class="auto-toggle">
        <input
          type="checkbox"
          checked={$loadouts.automaticEnabled}
          on:change={(event) => loadouts.setAutomaticEnabled((event.currentTarget as HTMLInputElement).checked)}
        />
        <span>{$t('options.loadouts.automatic', { default: 'Automatically apply matching loadouts' })}</span>
      </label>
    </div>

    <div class="loadout-list" role="list" aria-label={$t('options.loadouts.list.label', { default: 'Saved loadouts' })}>
      {#if $loadouts.loadouts.length === 0}
        <div class="empty-row">
          <span class="material-symbols-outlined" aria-hidden="true">bookmark_remove</span>
          <span>{$t('options.loadouts.list.empty', { default: 'No loadouts saved.' })}</span>
        </div>
      {:else}
        {#each $loadouts.loadouts as loadout (loadout.id)}
          <div class="loadout-row" role="listitem">
            <span class="type-glyph hover-tooltip-anchor" role="img" aria-label={typeLabel(loadout.target.type)}>
              <span class="material-symbols-outlined" aria-hidden="true">{TYPE_ICONS[loadout.target.type]}</span>
              <HoverTooltip align="left">{typeLabel(loadout.target.type)}</HoverTooltip>
            </span>
            <span class="loadout-name" title={loadout.name}>{loadout.name}</span>
            <span class="saved-categories" aria-label={$t('options.loadouts.list.savedCategories', { default: 'Saved categories' })}>
              {#each getLoadoutCategories(loadout.settings) as category}
                <span class="category-glyph hover-tooltip-anchor" role="img" aria-label={categoryLabel(category)}>
                  <span class="material-symbols-outlined" aria-hidden="true">{CATEGORY_ICONS[category]}</span>
                  <HoverTooltip placement="above" align="center">{categoryLabel(category)}</HoverTooltip>
                </span>
              {/each}
            </span>
            <span class="row-actions" aria-label={$t('options.loadouts.actions.forLoadout', { default: 'Actions for {name}', values: { name: loadout.name } })}>
              <OptionGlyphButton
                icon="download"
                label={$t('options.loadouts.actions.load', { default: 'Load' })}
                placement="above"
                on:click={() => applyLoadoutSettings(loadout.settings)}
              />
              <OptionGlyphButton
                icon="save"
                label={$t('options.loadouts.actions.update', { default: 'Update from current settings' })}
                placement="above"
                disabled={!canUpdateLoadout(loadout)}
                on:click={() => updateLoadout(loadout)}
              />
              <OptionGlyphButton
                icon="delete"
                label={$t('options.loadouts.actions.delete', { default: 'Delete' })}
                placement="above"
                danger
                on:click={() => loadouts.delete(loadout.id)}
              />
            </span>
          </div>
        {/each}
      {/if}
    </div>
  </section>
</article>

<style>
  .section-heading,
  .list-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 12px;
  }

  .section-heading h2,
  .list-heading h2 {
    margin-bottom: 3px;
  }

  .capture-bar {
    display: grid;
    grid-template-columns: max-content minmax(120px, 1fr) max-content max-content;
    align-items: center;
    gap: 5px;
    margin-top: 8px;
    padding: 7px;
    border: 1px solid var(--border-faint);
    border-radius: 7px;
    background: var(--bg-input);
  }

  .capture-bar select,
  .capture-bar input[type='text'] {
    min-width: 0;
    height: 27px;
    border: 1px solid var(--menu-bar-border);
    border-radius: 5px;
    padding: 3px 7px;
    background: var(--bg-card);
    color: var(--text);
    box-shadow: none;
    outline: none;
    appearance: none;
  }

  .capture-type-select {
    position: relative;
    display: block;
  }

  .capture-type-select select {
    width: 100%;
    padding-right: 25px;
  }

  .capture-type-select > .material-symbols-outlined {
    position: absolute;
    top: 50%;
    right: 6px;
    color: var(--muted-strong);
    pointer-events: none;
    transform: translateY(-50%);
  }

  .capture-bar select:focus-visible,
  .capture-bar input[type='text']:focus-visible {
    border-color: var(--accent);
  }

  .capture-bar select option {
    background: var(--menu-popover-bg);
    color: var(--menu-popover-text, var(--text-strong));
  }

  .capture-bar input[readonly] {
    color: var(--muted-strong);
  }

  .capture-bar input.invalid {
    border-color: #c8635b;
  }

  .category-toggles,
  .row-actions,
  .saved-categories {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .capture-note,
  .capture-error {
    margin: 5px 2px 0;
    color: var(--muted);
    font-size: 0.7rem;
  }

  .capture-error {
    color: #df7d75;
  }

  .auto-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    color: var(--muted-strong);
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .auto-toggle input {
    width: 1rem;
    height: 1rem;
    margin: 0;
    accent-color: var(--accent);
  }

  .loadout-list {
    margin-top: 8px;
    border-top: 1px solid var(--border-faint);
    border-bottom: 1px solid var(--border-faint);
  }

  .loadout-row {
    min-height: 32px;
    display: grid;
    grid-template-columns: 22px minmax(90px, 1fr) max-content max-content;
    align-items: center;
    gap: 7px;
    padding: 0 4px 0 7px;
    border-bottom: 1px solid var(--border-faint);
  }

  .loadout-row:last-child {
    border-bottom: 0;
  }

  .loadout-row:hover,
  .loadout-row:focus-within {
    background: var(--hover-surface);
  }

  .type-glyph,
  .category-glyph {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 26px;
    color: var(--muted-strong);
    border-radius: 4px;
  }

  .type-glyph:focus-visible,
  .category-glyph:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -2px;
  }

  .type-glyph > .material-symbols-outlined {
    color: var(--accent-strong);
  }

  .loadout-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .saved-categories {
    padding: 0 2px;
  }

  .row-actions {
    justify-content: flex-end;
  }

  .empty-row {
    min-height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 4px 0 7px;
    color: var(--muted);
  }

  @container (max-width: 480px) {
    .capture-bar {
      grid-template-columns: max-content minmax(100px, 1fr) max-content;
    }

    .category-toggles {
      grid-column: 1 / 3;
    }

    .list-heading {
      flex-direction: column;
      gap: 4px;
    }
  }
</style>
