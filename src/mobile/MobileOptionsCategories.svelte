<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { SharedOptionsViewDefinition } from '$lib/components/options/OptionsView.svelte';

  export let groups: SharedOptionsViewDefinition[][];
  export let auxiliaryViews: SharedOptionsViewDefinition[] = [];

  const dispatch = createEventDispatcher<{ select: { view: string } }>();

  $: descriptions = {
    'appearance': $t('mobile.options.descriptions.appearance', { default: 'Make izci feel like home.' }),
    'backdrops': $t('mobile.options.descriptions.backdrops', { default: 'Set the scene behind your music.' }),
    'now-playing': $t('mobile.options.descriptions.now-playing', { default: 'Give the current track center stage.' }),
    'visualizer': $t('mobile.options.descriptions.visualizer', { default: 'Let your music draw a little.' }),
    'patterns': $t('mobile.options.descriptions.patterns', { default: 'Watch the notes behind the noise.' }),
    'lyrics': $t('mobile.options.descriptions.lyrics', { default: 'Every word, right on cue.' }),
    'playback': $t('mobile.options.descriptions.playback', { default: 'Decide how the music keeps going.' }),
    'video': $t('mobile.options.descriptions.video', { default: 'Get the picture just right.' }),
    'raf': $t('mobile.options.descriptions.raf', { default: 'A little polish for your sound.' }),
    'modules': $t('mobile.options.descriptions.modules', { default: 'Old-school formats, your rules.' }),
    'oda': $t('mobile.options.descriptions.oda', { default: 'Set up for listening from the couch.' }),
    'tracks': $t('mobile.options.descriptions.tracks', { default: 'Keep your collection in order.' }),
    'folders': $t('mobile.options.descriptions.folders', { default: 'Tell izci where the music lives.' }),
    'metadata': $t('mobile.options.descriptions.metadata', { default: 'Names, tags, and listening milestones.' }),
    'loadouts': $t('mobile.options.descriptions.loadouts', { default: 'Save a setup for every mood.' }),
    'backups': $t('mobile.options.descriptions.backups', { default: 'Keep a spare copy of your setup.' }),
    'multiplayer': $t('mobile.options.descriptions.multiplayer', { default: 'Good music deserves company.' }),
    'hosting': $t('mobile.options.descriptions.hosting', { default: 'Make room for your listeners.' }),
    'cache': $t('mobile.options.descriptions.cache', { default: 'Keep shared tracks close at hand.' }),
    'experimental': $t('mobile.options.descriptions.experimental', { default: 'Try something still taking shape.' }),
    'about': $t('mobile.options.descriptions.about', { default: 'Meet the player behind the music.' }),
    'licenses': $t('mobile.options.descriptions.licenses', { default: 'A little credit where it is due.' }),
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
