<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import { formatTotalDuration } from './search';
  import type { LibraryGroup, LibraryGroupViewId } from './library-views';

  export let groups: LibraryGroup[] = [];
  export let view: LibraryGroupViewId = 'artists';
  export let artworkUrls: Record<string, string> = {};

  const dispatch = createEventDispatcher<{
    open: string;
    contextMenu: { key: string; event: MouseEvent };
  }>();

  const icons: Record<LibraryGroupViewId, string> = {
    artists: 'person',
    albums: 'album',
    genres: 'category',
    years: 'calendar_month',
    formats: 'extension',
    folders: 'folder'
  };
</script>

<ul class="library-group-list">
  {#each groups as group (group.key)}
    <li>
      <button
        type="button"
        class="library-group-row"
        class:album-row={view === 'albums'}
        on:click={() => dispatch('open', group.key)}
        on:contextmenu={(event) => dispatch('contextMenu', { key: group.key, event })}
      >
        {#if view === 'albums' && artworkUrls[group.key]}
          <img class="library-group-artwork" src={artworkUrls[group.key]} alt="" />
        {:else}
          <span
            class="library-group-icon material-symbols-outlined"
            class:album-placeholder={view === 'albums'}
            aria-hidden="true"
          >{icons[view]}</span>
        {/if}
        <span class="library-group-copy">
          <span class="library-group-name">{group.label}</span>
          {#if group.secondary}
            <span class="library-group-secondary" title={group.secondary}>{group.secondary}</span>
          {/if}
        </span>
        <span class="library-group-meta">
          <span>{$t('playlist.library.groupSongCount', {
            default: '{count, plural, one {# song} other {# songs}}',
            values: { count: group.items.length }
          })}</span>
          {#if group.duration > 0}
            <span class="library-group-meta-divider" aria-hidden="true">·</span>
            <span>{formatTotalDuration(group.duration)}</span>
          {/if}
        </span>
        <span class="library-group-open material-symbols-outlined" aria-hidden="true">chevron_right</span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .library-group-list {
    list-style: none;
    margin: 0;
    padding: 0 0.5rem 0.65rem;
  }

  .library-group-list li {
    position: relative;
  }

  .library-group-list li + li::after {
    content: '';
    position: absolute;
    top: 0;
    left: -0.5rem;
    right: -0.5rem;
    height: 1px;
    background: var(--border-subtle);
    pointer-events: none;
  }

  .library-group-row {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    min-width: 0;
    padding: 0.22rem 0.24rem;
    color: var(--text);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 4px;
  }

  .library-group-row:hover,
  .library-group-row:focus-visible {
    background: var(--hover-subtle);
  }

  .library-group-row.album-row {
    width: calc(100% + 0.5rem);
    min-height: 2rem;
    margin-left: -0.5rem;
    padding-block: 0;
    padding-left: 0;
  }

  .library-group-icon {
    color: var(--accent);
    font-size: 1.12rem;
  }

  .library-group-icon.album-placeholder {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
  }

  .library-group-artwork {
    width: 2rem;
    height: 2rem;
    object-fit: cover;
    border-radius: 0;
    background: var(--bg-card);
    box-shadow: inset 0 0 0 1px var(--border-subtle);
  }

  .library-group-copy {
    display: flex;
    align-items: baseline;
    min-width: 0;
    gap: 0.42rem;
    overflow: hidden;
  }

  .library-group-name,
  .library-group-secondary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .library-group-name {
    flex: 0 1 auto;
    min-width: 0;
    color: var(--text-strong);
    font-weight: 600;
  }

  .library-group-secondary {
    flex: 1 1 auto;
    min-width: 0;
  }

  .library-group-secondary,
  .library-group-meta {
    color: var(--muted);
    font-size: 0.72rem;
  }

  .library-group-meta {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    line-height: 1.25;
    white-space: nowrap;
  }

  .library-group-open {
    color: var(--muted);
    font-size: 1rem;
  }

  .library-group-meta-divider {
    color: var(--border-soft);
  }
</style>
