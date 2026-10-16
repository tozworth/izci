<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { SharedOptionsViewDefinition } from '$lib/components/options/OptionsView.svelte';

  export let groups: SharedOptionsViewDefinition[][];
  export let auxiliaryViews: SharedOptionsViewDefinition[] = [];

  const dispatch = createEventDispatcher<{ select: { view: string } }>();

  $: descriptions = {
    'appearance': $t('mobile.options.descriptions.appearance', { default: 'Language, theme, and interface.' }),
    'backdrops': $t('mobile.options.descriptions.backdrops', { default: 'Artwork and visualizer backgrounds.' }),
    'now-playing': $t('mobile.options.descriptions.now-playing', { default: 'Controls, panels, and artwork colors.' }),
    'visualizer': $t('mobile.options.descriptions.visualizer', { default: 'Style, colors, and animation.' }),
    'patterns': $t('mobile.options.descriptions.patterns', { default: 'Text size, channels, and scrolling.' }),
    'lyrics': $t('mobile.options.descriptions.lyrics', { default: 'Display style, font size, and scrolling.' }),
    'playback': $t('mobile.options.descriptions.playback', { default: 'Startup, transitions, speed, and volume.' }),
    'video': $t('mobile.options.descriptions.video', { default: 'Automatic theater and window resizing.' }),
    'raf': $t('mobile.options.descriptions.raf', { default: 'Equalizer, reverb, and audio effects.' }),
    'modules': $t('mobile.options.descriptions.modules', { default: 'Tracker module rendering and playback.' }),
    'oda': $t('mobile.options.descriptions.oda', { default: 'Couch mode display and controls.' }),
    'tracks': $t('mobile.options.descriptions.tracks', { default: 'Adding tracks, favorites, and ratings.' }),
    'folders': $t('mobile.options.descriptions.folders', { default: 'Saved folders and library scans.' }),
    'metadata': $t('mobile.options.descriptions.metadata', { default: 'Filename parsing and play counts.' }),
    'loadouts': $t('mobile.options.descriptions.loadouts', { default: 'Saved settings and track or folder rules.' }),
    'backups': $t('mobile.options.descriptions.backups', { default: 'Export and restore settings and library data.' }),
    'multiplayer': $t('mobile.options.descriptions.multiplayer', { default: 'Connection mode and shared playback.' }),
    'hosting': $t('mobile.options.descriptions.hosting', { default: 'Host setup, audio delivery, and chat.' }),
    'cache': $t('mobile.options.descriptions.cache', { default: 'Cached Multiplayer audio and storage limits.' }),
    'experimental': $t('mobile.options.descriptions.experimental', { default: 'Enable or disable experimental features.' }),
    'about': $t('mobile.options.descriptions.about', { default: 'App version and project information.' }),
    'licenses': $t('mobile.options.descriptions.licenses', { default: 'Third-party software licenses.' }),
  } as Record<string, string>;

  $: visibleGroups = groups.map((group) => group.flatMap((view) =>
    [view, ...auxiliaryViews.filter((auxiliary) => auxiliary.parentId === view.id)]
  ).filter((view) => !view.hidden)).filter((group) => group.length > 0);
</script>

{#each visibleGroups as group}
  <ul class="mobile-options-category-group">
    {#each group as view (view.id)}
      <li>
        <button class="mobile-options-category" class:child={view.parentId != null} type="button" data-view={view.id} on:click={() => dispatch('select', { view: view.id })}>
          <span class="material-symbols-outlined mobile-options-category-icon" aria-hidden="true">{view.icon}</span>
          <span class="mobile-options-category-text">
            <span class="mobile-options-category-name">{view.label}</span>
            <small>{descriptions[view.id]}</small>
          </span>
          <span class="material-symbols-outlined mobile-options-category-arrow" aria-hidden="true">chevron_right</span>
        </button>
      </li>
    {/each}
  </ul>
{/each}
