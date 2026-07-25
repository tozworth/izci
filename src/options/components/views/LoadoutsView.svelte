<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import { translate } from '$lib/i18n';
  import { filesystemFolders } from '$lib/services/filesystem-folders';
  import { loadoutTrackContext } from '$lib/services/loadout-track-context';
  import {
    getLoadoutSettingDifferences,
    type LoadoutSettingDifference,
    type LoadoutSettingDifferenceKey
  } from '$lib/services/loadout-setting-differences';
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
  let draggedLoadoutId: string | null = null;
  let dropBoundary: number | null = null;

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

  function translatedOption(key: string, fallback: string): string {
    return translate(key, { default: fallback });
  }

  function settingLabel(key: LoadoutSettingDifferenceKey): string {
    if (key === 'playbackRate') return translatedOption('options.playback.playbackRate.title', 'Playback speed');
    if (key === 'trueSpeed') return translatedOption('options.playback.trueSpeed.title', 'True speed');
    if (key === 'replayGainMode') return translatedOption('options.playback.replayGain.title', 'ReplayGain');
    if (key === 'rafEnabled') return $t('options.loadouts.tooltip.rafEnabled', { default: 'Raf' });
    if (key === 'interpolationFilter') return translatedOption('options.modules.interpolation.title', 'Interpolation');
    if (key === 'stereoSeparation') return translatedOption('options.modules.stereoSeparation.title', 'Stereo separation (MOD)');
    if (key === 'panStrength') return translatedOption('options.modules.panStrength.title', 'Pan strength');
    if (key === 'repeatCount') return translatedOption('options.modules.looping.title', 'Looping');
    if (key === 'tempoFactor') return translatedOption('options.modules.tempoFactor.title', 'Tempo factor');
    if (key === 'pitchFactor') return translatedOption('options.modules.pitchFactor.title', 'Pitch factor');
    if (key === 'backdropLeft') return translatedOption('options.backdrops.zones.left', 'Left');
    if (key === 'backdropCenter') return translatedOption('options.backdrops.zones.center', 'Center');
    if (key === 'backdropRight') return translatedOption('options.backdrops.zones.right', 'Right');
    if (key === 'backdropPlayer') return translatedOption('options.backdrops.zones.player', 'Player Bar');
    if (key === 'backdropNowPlaying') return translatedOption('options.backdrops.zones.nowPlaying', 'Now Playing');
    if (key === 'visualizerStyle') return $t('options.loadouts.tooltip.visualizer', { default: 'Visualizer' });
    if (key === 'visualizerColorSource') return translatedOption('options.visualizer.colorSource.title', 'Color source');
    if (key === 'visualizerHeight') return translatedOption('options.visualizer.height.title', 'Height');
    if (key === 'visualizerTransparency') return translatedOption('options.visualizer.opacity.title', 'Opacity');
    if (key === 'visualizerFrameRateLimit') return translatedOption('options.visualizer.frameCap.title', 'Frame cap');
    if (key === 'visualizerNormalizationStrength') return translatedOption('options.visualizer.normalization.title', 'Normalization');
    if (key === 'visualizerTriangleCount') return translatedOption('options.visualizer.triangleCount.title', 'Triangle count');
    if (key === 'visualizerTriangleMinSize') return translatedOption('options.visualizer.triangleMinSize.title', 'Minimum triangle size');
    if (key === 'visualizerTriangleMaxSize') return translatedOption('options.visualizer.triangleMaxSize.title', 'Maximum triangle size');
    if (key === 'visualizerTriangleBaseSpeed') return translatedOption('options.visualizer.triangleBaseSpeed.title', 'Base rise speed');
    if (key === 'visualizerTriangleReactiveSpeed') return translatedOption('options.visualizer.triangleReactiveSpeed.title', 'Reactive rise speed');
    return translatedOption('options.visualizer.triangleBorderWidth.title', 'Border thickness');
  }

  function backdropEffectLabel(value: string): string {
    if (value === 'none') return translatedOption('options.backdrops.effects.none', 'None');
    if (value === 'artwork') return translatedOption('options.backdrops.effects.artwork', 'Artwork');
    if (value === 'visualizer') return translatedOption('options.backdrops.effects.visualizer', 'Visualizer');
    return translatedOption('options.backdrops.effects.both', 'Both');
  }

  function visualizerStyleLabel(value: string): string {
    if (value === 'bars') return translatedOption('options.visualizer.options.bars', 'Spectrum bars');
    if (value === 'mirror') return translatedOption('options.visualizer.options.mirror', 'Mirror bloom');
    if (value === 'blocks') return translatedOption('options.visualizer.options.blocks', 'Pixel blocks');
    if (value === 'triangles') return translatedOption('options.visualizer.options.triangles', 'Rhythm triangles');
    return translatedOption('options.visualizer.options.wave', 'Uniform wave');
  }

  function settingValue(difference: LoadoutSettingDifference): string {
    const { key, value } = difference;
    if (key === 'trueSpeed' || key === 'rafEnabled') {
      return value
        ? $t('options.loadouts.tooltip.on', { default: 'on' })
        : $t('options.loadouts.tooltip.off', { default: 'off' });
    }
    if (key === 'playbackRate') return `${value}x`;
    if (key === 'replayGainMode') {
      if (value === 'album') return translatedOption('options.playback.replayGain.options.album', 'Album');
      if (value === 'off') return translatedOption('options.playback.replayGain.options.off', 'Off');
      return translatedOption('options.playback.replayGain.options.track', 'Track');
    }
    if (key === 'interpolationFilter') return `${value}-tap`;
    if (key === 'stereoSeparation' || key === 'panStrength') return `${value}%`;
    if (key === 'repeatCount') {
      if (value === -1) return translatedOption('options.modules.looping.forever', 'Loop forever');
      if (value === 0) return translatedOption('options.modules.looping.once', 'Play once');
      return $t('options.loadouts.tooltip.repeatCount', { default: '{count} repeats', values: { count: value } });
    }
    if (key === 'tempoFactor' || key === 'pitchFactor') {
      const numericValue = Number(value);
      return `${Math.round(numericValue * 100)}% (${numericValue.toFixed(2)}x)`;
    }
    if (key.startsWith('backdrop')) return backdropEffectLabel(String(value));
    if (key === 'visualizerStyle') return visualizerStyleLabel(String(value));
    if (key === 'visualizerColorSource') {
      return value === 'artwork'
        ? translatedOption('options.visualizer.options.artwork', 'Follow artwork')
        : translatedOption('options.visualizer.options.theme', 'Follow theme');
    }
    if (key === 'visualizerHeight' || key === 'visualizerTransparency' || key === 'visualizerNormalizationStrength'
      || key === 'visualizerTriangleMinSize' || key === 'visualizerTriangleMaxSize') {
      return `${Math.round(Number(value) * 100)}%`;
    }
    if (key === 'visualizerFrameRateLimit') return `${value} fps`;
    if (key === 'visualizerTriangleBaseSpeed' || key === 'visualizerTriangleReactiveSpeed') return `${Number(value).toFixed(2)}x`;
    if (key === 'visualizerTriangleBorderWidth') return `${value}px`;
    return String(value);
  }

  function categoryAriaLabel(loadout: Loadout, category: LoadoutCategory): string {
    const differences = getLoadoutSettingDifferences(loadout.settings, category);
    if (differences.length === 0) {
      return `${categoryLabel(category)}. ${$t('options.loadouts.tooltip.defaults', { default: 'Defaults' })}`;
    }
    const details = differences.map((difference) => difference.key === 'rafPresetName'
      ? String(difference.value)
      : `${settingLabel(difference.key)}: ${settingValue(difference)}`
    );
    return [categoryLabel(category), ...details].join('. ');
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

  function startLoadoutDrag(event: DragEvent, loadout: Loadout, index: number): void {
    draggedLoadoutId = loadout.id;
    dropBoundary = index;
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('text/plain', loadout.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  function updateDropBoundary(event: DragEvent, index: number): void {
    if (!draggedLoadoutId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropBoundary = event.clientY < bounds.top + bounds.height / 2 ? index : index + 1;
  }

  function dropLoadout(event: DragEvent): void {
    event.preventDefault();
    if (draggedLoadoutId && dropBoundary !== null) {
      const sourceIndex = $loadouts.loadouts.findIndex((loadout) => loadout.id === draggedLoadoutId);
      const targetIndex = dropBoundary > sourceIndex ? dropBoundary - 1 : dropBoundary;
      loadouts.move(draggedLoadoutId, targetIndex);
    }
    clearLoadoutDrag();
  }

  function clearLoadoutDrag(): void {
    draggedLoadoutId = null;
    dropBoundary = null;
  }

  function handleReorderKeydown(event: KeyboardEvent, loadout: Loadout, index: number): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    loadouts.move(loadout.id, index + (event.key === 'ArrowUp' ? -1 : 1));
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
      <h2>{$t('options.loadouts.list.heading', { default: 'Loadouts' })}</h2>
      <label class="auto-toggle">
        <span>{$t('options.loadouts.automatic', { default: 'Auto-apply' })}</span>
        <input
          type="checkbox"
          checked={$loadouts.automaticEnabled}
          on:change={(event) => loadouts.setAutomaticEnabled((event.currentTarget as HTMLInputElement).checked)}
        />
      </label>
    </div>
    <p class="field-hint">{$t('options.loadouts.list.hint', { default: 'Drag to set priority. The first automatic match from top to bottom is applied.' })}</p>

    <div
      class="loadout-list"
      class:show-tail-drop-line={draggedLoadoutId !== null && dropBoundary === $loadouts.loadouts.length}
      role="list"
      aria-label={$t('options.loadouts.list.label', { default: 'Saved loadouts' })}
      on:drop={dropLoadout}
      on:dragend={clearLoadoutDrag}
    >
      {#if $loadouts.loadouts.length === 0}
        <div class="empty-row">
          <span class="material-symbols-outlined" aria-hidden="true">bookmark_remove</span>
          <span>{$t('options.loadouts.list.empty', { default: 'No loadouts saved.' })}</span>
        </div>
      {:else}
        {#each $loadouts.loadouts as loadout, index (loadout.id)}
          <div
            class="loadout-row"
            class:is-dragging={draggedLoadoutId === loadout.id}
            class:show-drop-line={draggedLoadoutId !== null && dropBoundary === index}
            role="listitem"
            on:dragover={(event) => updateDropBoundary(event, index)}
          >
            <button
              class="drag-handle"
              draggable="true"
              title={$t('options.loadouts.actions.dragToReorder', { default: 'Drag {name} to reorder', values: { name: loadout.name } })}
              aria-label={$t('options.loadouts.actions.dragToReorder', { default: 'Drag {name} to reorder', values: { name: loadout.name } })}
              on:dragstart={(event) => startLoadoutDrag(event, loadout, index)}
              on:keydown={(event) => handleReorderKeydown(event, loadout, index)}
            ><span class="material-symbols-outlined" aria-hidden="true">drag_indicator</span></button>
            <span class="type-glyph hover-tooltip-anchor" role="img" aria-label={typeLabel(loadout.target.type)}>
              <span class="material-symbols-outlined" aria-hidden="true">{TYPE_ICONS[loadout.target.type]}</span>
              <HoverTooltip align="left">{typeLabel(loadout.target.type)}</HoverTooltip>
            </span>
            <span class="loadout-name" title={loadout.name}>{loadout.name}</span>
            <span class="saved-categories" aria-label={$t('options.loadouts.list.savedCategories', { default: 'Saved categories' })}>
              {#each getLoadoutCategories(loadout.settings) as category}
                {@const differences = getLoadoutSettingDifferences(loadout.settings, category)}
                <span class="category-glyph hover-tooltip-anchor" role="img" aria-label={categoryAriaLabel(loadout, category)}>
                  <span class="material-symbols-outlined" aria-hidden="true">{CATEGORY_ICONS[category]}</span>
                  <HoverTooltip placement="above" align="center">
                    <span class="loadout-tooltip">
                      <strong>{categoryLabel(category)}</strong>
                      {#if differences.length === 0}
                        <span class="loadout-tooltip-defaults">{$t('options.loadouts.tooltip.defaults', { default: 'Defaults' })}</span>
                      {:else}
                        {#each differences as difference}
                          <span class="loadout-tooltip-line">
                            {#if difference.key === 'rafPresetName'}
                              {difference.value}
                            {:else}
                              <span>{settingLabel(difference.key)}:</span> {settingValue(difference)}
                            {/if}
                          </span>
                        {/each}
                      {/if}
                    </span>
                  </HoverTooltip>
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
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .section-heading {
    align-items: start;
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
    position: relative;
    margin-top: 8px;
    border-top: 1px solid var(--border-faint);
    border-bottom: 1px solid var(--border-faint);
  }

  .loadout-row {
    position: relative;
    min-height: 32px;
    display: grid;
    grid-template-columns: 18px 22px minmax(90px, 1fr) max-content max-content;
    align-items: center;
    gap: 5px;
    padding: 0 4px 0 2px;
    border-bottom: 1px solid var(--border-faint);
  }

  .loadout-row:last-child {
    border-bottom: 0;
  }

  .loadout-row:hover,
  .loadout-row:focus-within {
    background: var(--hover-surface);
  }

  .loadout-row.is-dragging {
    opacity: 0.55;
  }

  .loadout-row.show-drop-line::before,
  .loadout-list.show-tail-drop-line::after {
    content: '';
    position: absolute;
    z-index: 2;
    left: 2px;
    right: 2px;
    top: -1px;
    height: 2px;
    background: var(--accent-strong);
    pointer-events: none;
  }

  .loadout-list.show-tail-drop-line::after {
    top: auto;
    bottom: -1px;
  }

  .drag-handle {
    width: 18px;
    height: 32px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    cursor: grab;
    opacity: 0;
  }

  .loadout-row:hover .drag-handle,
  .loadout-row:focus-within .drag-handle,
  .drag-handle:focus-visible {
    opacity: 1;
  }

  .drag-handle:hover,
  .drag-handle:focus-visible {
    color: var(--text-strong);
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .type-glyph,
  .category-glyph {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 26px;
    color: var(--accent-strong);
    border-radius: 4px;
  }

  .type-glyph:focus-visible,
  .category-glyph:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -2px;
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

  .loadout-tooltip {
    display: grid;
    gap: 2px;
    min-width: max-content;
    text-align: left;
  }

  .loadout-tooltip strong {
    margin-bottom: 1px;
  }

  .loadout-tooltip-line {
    display: block;
  }

  .loadout-tooltip-defaults {
    color: var(--muted);
  }

  .row-actions {
    justify-content: flex-end;
    opacity: 0;
    pointer-events: none;
  }

  .loadout-row:hover .row-actions,
  .row-actions:focus-within {
    opacity: 1;
    pointer-events: auto;
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
