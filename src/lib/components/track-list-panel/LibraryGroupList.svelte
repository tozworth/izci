<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import { formatTotalDuration } from './search';
  import type { LibraryGroup, LibraryGroupViewId } from './library-views';

  export let groups: LibraryGroup[] = [];
  export let view: LibraryGroupViewId = 'artists';
  export let artworkUrls: Record<string, string> = {};
  export let pinnedKeys: string[] = [];
  export let searchActive = false;

  const dispatch = createEventDispatcher<{
    open: string;
    contextMenu: { key: string; event: MouseEvent };
    unpin: string;
    movePin: { key: string; targetKey: string; position: 'before' | 'after' };
  }>();

  let draggedKey: string | null = null;
  let dropTarget: { key: string; position: 'before' | 'after' } | null = null;
  let expandedKeys = new Set<string>();

  $: pinnedKeySet = new Set(pinnedKeys);
  $: groupsByKey = new Map(groups.map((group) => [group.key, group]));
  $: visibleGroups = view !== 'folders' || searchActive
    ? groups
    : groups.filter((group) => {
        let parentKey = group.parentKey;
        while (parentKey) {
          if (!expandedKeys.has(parentKey)) return false;
          parentKey = groupsByKey.get(parentKey)?.parentKey;
        }
        return true;
      });

  const icons: Record<LibraryGroupViewId, string> = {
    artists: 'person',
    albums: 'album',
    genres: 'category',
    years: 'calendar_month',
    formats: 'extension',
    folders: 'folder'
  };

  function handleDragStart(event: DragEvent, key: string) {
    if (!pinnedKeySet.has(key) || !event.dataTransfer) {
      event.preventDefault();
      return;
    }

    draggedKey = key;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
  }

  function handleDragOver(event: DragEvent, targetKey: string) {
    if (!draggedKey || draggedKey === targetKey || !pinnedKeySet.has(targetKey)) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;

    const bounds = target.getBoundingClientRect();
    dropTarget = {
      key: targetKey,
      position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
    };
  }

  function handleDrop(event: DragEvent, targetKey: string) {
    if (!draggedKey || !dropTarget || dropTarget.key !== targetKey) return;

    event.preventDefault();
    event.stopPropagation();
    dispatch('movePin', {
      key: draggedKey,
      targetKey,
      position: dropTarget.position
    });
    draggedKey = null;
    dropTarget = null;
  }

  function handleDragEnd() {
    draggedKey = null;
    dropTarget = null;
  }

  function handleListDragOver(event: DragEvent) {
    if (!draggedKey) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleListDrop(event: DragEvent) {
    if (!draggedKey) return;
    event.preventDefault();
    event.stopPropagation();
    draggedKey = null;
    dropTarget = null;
  }

  function toggleFolder(event: MouseEvent, key: string) {
    event.stopPropagation();
    const next = new Set(expandedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedKeys = next;
  }
</script>

<ul class="library-group-list" on:dragover={handleListDragOver} on:drop={handleListDrop}>
  {#each visibleGroups as group, index (group.key)}
    {@const pinned = pinnedKeySet.has(group.key)}
    {@const pinnedBoundary = pinned && Boolean(visibleGroups[index + 1]) && !pinnedKeySet.has(visibleGroups[index + 1].key)}
    <li
      class:pinned
      class:pinned-boundary={pinnedBoundary}
      class:drop-before={dropTarget?.key === group.key && dropTarget.position === 'before'}
      class:drop-after={dropTarget?.key === group.key && dropTarget.position === 'after'}
      draggable={pinned}
      on:dragstart={(event) => handleDragStart(event, group.key)}
      on:dragover={(event) => handleDragOver(event, group.key)}
      on:drop={(event) => handleDrop(event, group.key)}
      on:dragend={handleDragEnd}
    >
      <div
        class="library-group-row"
        class:album-row={view === 'albums'}
        class:folder-tree-row={view === 'folders'}
        style:--folder-depth={group.depth ?? 0}
        role="group"
        on:contextmenu={(event) => dispatch('contextMenu', { key: group.key, event })}
      >
        <button
          type="button"
          class="library-group-hit-target"
          aria-label={$t('library.openGroup', {
            default: 'Open {group}',
            values: { group: group.label }
          })}
          on:click={() => dispatch('open', group.key)}
        ></button>
        {#if view === 'folders'}
          {#if group.hasChildren}
            <button
              type="button"
              class="library-folder-disclosure"
              aria-label={expandedKeys.has(group.key)
                ? $t('library.collapseFolder', { default: 'Collapse {folder}', values: { folder: group.label } })
                : $t('library.expandFolder', { default: 'Expand {folder}', values: { folder: group.label } })}
              aria-expanded={expandedKeys.has(group.key) || searchActive}
              on:click={(event) => toggleFolder(event, group.key)}
            >
              <span class="material-symbols-outlined" aria-hidden="true">{expandedKeys.has(group.key) || searchActive ? 'expand_more' : 'chevron_right'}</span>
            </button>
          {:else}
            <span class="library-folder-disclosure-spacer" aria-hidden="true"></span>
          {/if}
        {/if}
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
        {#if pinned}
          <button
            type="button"
            class="library-group-unpin hover-tooltip-anchor"
            aria-label={$t('library.unpinNamed', {
              default: 'Unpin {group}',
              values: { group: group.label }
            })}
            draggable="false"
            on:click={() => dispatch('unpin', group.key)}
          >
            <span class="material-symbols-outlined" aria-hidden="true">keep</span>
            <HoverTooltip align="center" nowrap>
              {$t('library.unpin', { default: 'Unpin' })}
            </HoverTooltip>
          </button>
        {:else}
          <span class="library-group-pin-spacer" aria-hidden="true"></span>
        {/if}
        <span class="library-group-meta">
          <span class="library-group-song-count">{$t('library.groupSongCount', {
            default: '{count, plural, one {# song} other {# songs}}',
            values: { count: group.items.length }
          })}</span>
          {#if group.duration > 0}
            <span class="library-group-meta-divider" aria-hidden="true">·</span>
            <span class="library-group-runtime">{formatTotalDuration(group.duration)}</span>
          {/if}
        </span>
        <span class="library-group-open material-symbols-outlined" aria-hidden="true">chevron_right</span>
      </div>
    </li>
  {/each}
</ul>

<style>
  .library-group-list {
    container: library-groups / inline-size;
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

  .library-group-list li.pinned-boundary + li::after {
    height: 2px;
    background: var(--border);
  }

  .library-group-list li.drop-before::before,
  .library-group-list li.drop-after::before {
    content: '';
    position: absolute;
    z-index: 3;
    left: -0.5rem;
    right: -0.5rem;
    height: 2px;
    background: var(--accent);
    pointer-events: none;
  }

  .library-group-list li.drop-before::before {
    top: -1px;
  }

  .library-group-list li.drop-after::before {
    bottom: -1px;
  }

  .library-group-row {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 1rem auto auto;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    min-width: 0;
    padding: 0.22rem 0.24rem;
    color: var(--text);
    text-align: left;
    border-radius: 4px;
  }

  .library-group-row.folder-tree-row {
    grid-template-columns: auto auto minmax(0, 1fr) 1rem auto auto;
    padding-left: calc(0.24rem + var(--folder-depth) * 0.9rem);
  }

  .library-group-hit-target {
    position: absolute;
    z-index: 0;
    inset: 0;
    width: 100%;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: inherit;
  }

  .library-group-row:hover .library-group-hit-target,
  .library-group-hit-target:focus-visible {
    background: var(--hover-subtle);
  }

  .library-group-row > :not(.library-group-hit-target) {
    position: relative;
    z-index: 1;
    pointer-events: none;
  }

  .library-group-row > .library-group-unpin {
    pointer-events: auto;
  }

  .library-group-row > .library-folder-disclosure {
    pointer-events: auto;
  }

  .library-folder-disclosure,
  .library-folder-disclosure-spacer {
    width: 0.9rem;
    height: 1rem;
  }

  .library-folder-disclosure {
    display: grid;
    place-items: center;
    padding: 0;
    color: var(--muted);
    background: transparent;
    border: 0;
    border-radius: 2px;
  }

  .library-folder-disclosure:hover,
  .library-folder-disclosure:focus-visible {
    color: var(--text-strong);
    background: var(--hover);
  }

  .library-folder-disclosure .material-symbols-outlined {
    font-size: 0.9rem;
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

  .library-group-unpin {
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    padding: 0;
    color: var(--muted);
    background: transparent;
    border: 0;
    border-radius: 3px;
  }

  .library-group-unpin:hover,
  .library-group-unpin:focus-visible {
    color: var(--text-strong);
    background: var(--hover);
  }

  .library-group-unpin .material-symbols-outlined {
    font-size: 0.78rem;
  }

  .library-group-open {
    color: var(--muted);
    font-size: 1rem;
  }

  .library-group-meta-divider {
    color: var(--border-soft);
  }

  @container library-groups (max-width: 26rem) {
    .library-group-runtime,
    .library-group-meta-divider {
      display: none;
    }
  }

  @container library-groups (max-width: 20rem) {
    .library-group-meta {
      display: none;
    }
  }

  @container library-groups (max-width: 14rem) {
    .library-group-secondary {
      display: none;
    }
  }
</style>
