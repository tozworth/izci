<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import {
    MAX_UP_NEXT_PANEL_HEIGHT_PX,
    MIN_UP_NEXT_PANEL_HEIGHT_PX,
    upNextPanelSettings
  } from '$lib/stores/up-next-panel-settings';
  import { upNext } from '$lib/stores/up-next';
  import type { MenuActionItem, TrackItem } from '$lib/types';
  import TrackRow from '$lib/components/track-list-panel/TrackRow.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { buildOrderedSelection, isToggleSelection } from '$lib/components/track-list-panel/selection';
  import type { TrackListPanelContextMenu } from '$lib/components/track-list-panel/context-menu';

  export let items: TrackItem[] = [];
  export let playingId: string | null = null;
  export let mobilePresentation = false;
  export let getContextMenuActions: (ids: string[]) => MenuActionItem[] = () => [
    { id: 'remove-from-up-next', label: 'Remove from up next', icon: 'remove' }
  ];

  const dispatch = createEventDispatcher<{
    activate: string;
    contextAction: { actionId: string; ids: string[] };
  }>();

  let contextMenu: TrackListPanelContextMenu | null = null;
  let selectedIds: string[] = [];
  let selectionAnchorId: string | null = null;
  let panelElement: HTMLElement | null = null;
  let resizeHeight = 0;
  let resizing = false;
  let resizeStartY = 0;
  let resizeStartHeight = 0;

  $: alwaysShowUpNext = $appearanceSettings.alwaysShowUpNext;
  $: panelVisible = alwaysShowUpNext || items.length > 0;
  $: expanded = alwaysShowUpNext || $upNextPanelSettings.expanded;
  $: queueCount = items.length;
  $: displayedHeight = resizing ? resizeHeight : $upNextPanelSettings.heightPx;

  function toggleExpanded(): void {
    if (alwaysShowUpNext) return;
    upNextPanelSettings.update({ expanded: !expanded });
  }

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    resizing = true;
    resizeStartY = event.clientY;
    resizeStartHeight = $upNextPanelSettings.heightPx;
    resizeHeight = resizeStartHeight;
  }

  function handleWindowPointerMove(event: PointerEvent): void {
    if (!resizing) return;
    const maxHeight = Math.min(
      MAX_UP_NEXT_PANEL_HEIGHT_PX,
      Math.max((typeof window !== 'undefined' ? window.innerHeight : 0) * 0.5, MIN_UP_NEXT_PANEL_HEIGHT_PX)
    );
    resizeHeight = Math.min(
      Math.max(resizeStartHeight + (resizeStartY - event.clientY), MIN_UP_NEXT_PANEL_HEIGHT_PX),
      maxHeight
    );
  }

  function endResize(): void {
    if (!resizing) return;
    resizing = false;
    upNextPanelSettings.update({ heightPx: Math.round(resizeHeight) });
  }

  function closeContextMenu(): void {
    contextMenu = null;
  }

  function handleWindowDismiss(): void {
    closeContextMenu();
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && contextMenu) {
      event.stopPropagation();
      closeContextMenu();
    }
  }

  function emitSelection(event: MouseEvent, id: string): void {
    const nextSelection = buildOrderedSelection(
      items,
      selectedIds,
      selectionAnchorId,
      id,
      event.shiftKey,
      isToggleSelection(event)
    );
    selectedIds = nextSelection.ids;
    selectionAnchorId = nextSelection.anchorId;
  }

  function handleItemClick(event: MouseEvent, id: string): void {
    if (mobilePresentation && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      closeContextMenu();
      dispatch('activate', id);
      return;
    }

    emitSelection(event, id);
    closeContextMenu();
  }

  function handleItemDoubleClick(id: string): void {
    dispatch('activate', id);
  }

  function handleItemContextMenu(event: MouseEvent, id: string): void {
    event.preventDefault();

    const itemIsSelected = selectedIds.includes(id);

    if (!itemIsSelected) {
      selectedIds = [id];
      selectionAnchorId = id;
    }

    contextMenu = {
      kind: 'items',
      x: event.clientX,
      y: event.clientY,
      ids: itemIsSelected ? selectedIds : [id]
    };
  }

  function handleContextAction(actionId: string): void {
    if (!contextMenu || contextMenu.kind !== 'items') {
      return;
    }

    dispatch('contextAction', {
      actionId,
      ids: contextMenu.ids
    });
    closeContextMenu();
  }

  function handleClearQueue(): void {
    upNext.clear();
  }

  function getContextMenuActionLabel(action: MenuActionItem): string {
    switch (action.id) {
      case 'go-to-library': return $t('queue.actions.goTo', { default: 'Go to...' });
      case 'go-to-library-artist': return $t('library.columns.artist', { default: 'Artist' });
      case 'go-to-library-album': return $t('main.trackDetails.album', { default: 'Album' });
      case 'go-to-library-genre': return $t('main.trackDetails.genre', { default: 'Genre' });
      case 'go-to-library-year': return $t('main.trackDetails.year', { default: 'Year' });
      case 'go-to-library-format': return $t('main.trackDetails.format', { default: 'Format' });
      case 'track-details': return $t('queue.actions.trackDetails', { default: 'Track details' });
      case 'toggle-library': return action.icon === 'remove_circle'
        ? $t('queue.actions.removeFromLibrary', { default: 'Remove from library' })
        : $t('queue.actions.addToLibrary', { default: 'Add to library' });
      case 'toggle-favorite': return action.icon === 'heart_minus'
        ? $t('queue.actions.removeFromFavorites', { default: 'Remove from favorites' })
        : $t('queue.actions.addToFavorites', { default: 'Add to favorites' });
      case 'rate': return $t('queue.actions.rate', { default: 'Rate' });
      case 'rate:clear': return $t('queue.actions.clearRating', { default: 'Clear rating' });
      case 'separate-subsongs': return $t('queue.actions.separateSubsongs', { default: 'Separate subsongs' });
      case 'copy-filename': return $t('queue.actions.copyFilename', { default: 'Copy filename' });
      case 'remove-from-up-next': return $t('queue.actions.removeFromUpNext', { default: 'Remove from up next' });
      case 'remove': return $t('queue.actions.remove', { default: 'Remove' });
      default: return action.label;
    }
  }

  function getContextMenuShortcut(shortcut: string | undefined): string | undefined {
    return shortcut === 'Delete'
      ? $t('queue.shortcuts.delete', { default: 'Delete' })
      : shortcut;
  }

  function localizeContextMenuAction(action: MenuActionItem): MenuActionItem {
    return {
      ...action,
      label: getContextMenuActionLabel(action),
      shortcut: getContextMenuShortcut(action.shortcut),
      children: action.children?.map(localizeContextMenuAction)
    };
  }

  $: contextMenuItems = contextMenu && contextMenu.kind === 'items'
    ? getContextMenuActions(contextMenu.ids).map(localizeContextMenuAction)
    : [];

  $: contextMenuAriaLabel = $t('queue.upNext.contextMenu', {
    default: 'Up Next item actions',
    values: { count: queueCount }
  });

  $: queueSummary = $t('queue.upNext.count', {
    default: '{count, plural, one {# song up next} other {# songs up next}}',
    values: { count: queueCount }
  });

  $: queueEmptyNote = $t('queue.upNext.empty', { default: 'Up Next is empty' });

  onDestroy(() => {
    contextMenu = null;
  });

  async function focusItem(id: string): Promise<void> {
    await tick();

    if (!panelElement || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
      return;
    }

    const rowButton = panelElement.querySelector<HTMLButtonElement>(
      `[data-track-id="${CSS.escape(id)}"] [data-track-row-button]`
    );
    rowButton?.focus();
  }

  function handleWindowKeydownNavigate(event: KeyboardEvent): void {
    if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.target instanceof Element &&
      panelElement?.contains(event.target)
    ) {
      const currentRow = event.target.closest<HTMLElement>('[data-track-id]');
      const currentIndex = currentRow
        ? items.findIndex((item) => item.id === currentRow.dataset.trackId)
        : -1;

      if (currentIndex < 0) {
        return;
      }

      const nextIndex = Math.min(Math.max(currentIndex + (event.key === 'ArrowUp' ? -1 : 1), 0), items.length - 1);
      const nextItem = items[nextIndex];
      event.preventDefault();

      if (!nextItem || nextIndex === currentIndex) {
        return;
      }

      const nextSelection = buildOrderedSelection(
        items,
        selectedIds,
        selectionAnchorId,
        nextItem.id,
        event.shiftKey,
        false
      );
      selectedIds = nextSelection.ids;
      selectionAnchorId = nextSelection.anchorId;
      void focusItem(nextItem.id);
    }
  }
</script>

<svelte:window
  on:pointermove={handleWindowPointerMove}
  on:pointerup={endResize}
  on:keydown={handleWindowKeydown}
  on:keydown={handleWindowKeydownNavigate}
  on:blur={handleWindowDismiss}
  on:resize={handleWindowDismiss}
/>

{#if panelVisible}
  <section
    bind:this={panelElement}
    class="queue-panel"
    class:expanded={expanded}
    class:is-resizing={resizing}
    class:mobile-presentation={mobilePresentation}
    aria-label={$t('queue.upNext.title', { default: 'Up Next' })}
    style={expanded && !mobilePresentation ? `height: ${displayedHeight}px;` : undefined}
  >
    {#if expanded && !mobilePresentation}
      <div
        class="queue-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label={$t('queue.upNext.resize', { default: 'Resize up next' })}
        on:pointerdown={startResize}
      >
        <span class="queue-resizer-handle" aria-hidden="true"></span>
      </div>
    {/if}

    <div
      class="queue-header"
      role="button"
      tabindex="0"
      aria-expanded={expanded}
      aria-label={$t('queue.upNext.title', { default: 'Up Next' })}
      title={queueSummary}
      on:click={toggleExpanded}
      on:keydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleExpanded();
        }
      }}
    >
      <span class="queue-header-leading">
        {#if !alwaysShowUpNext}
          <span class="material-symbols-outlined queue-chevron" aria-hidden="true">
            {expanded ? 'expand_less' : 'expand_more'}
          </span>
        {/if}
        <span class="queue-title">
          {$t('queue.upNext.title', { default: 'Up Next' })}
        </span>
        <span class="queue-count" title={queueSummary}>{queueCount}</span>
      </span>
      {#if expanded && queueCount > 0}
        <button
          type="button"
          class="queue-clear-button"
          aria-label={$t('queue.upNext.clear', { default: 'Clear up next' })}
          title={$t('queue.upNext.clear', { default: 'Clear up next' })}
          on:click={(event) => {
            event.stopPropagation();
            handleClearQueue();
          }}
        >
          <span class="material-symbols-outlined" aria-hidden="true">delete_sweep</span>
        </button>
      {/if}
    </div>

    {#if expanded}
      <ul class="queue-list" class:mobile-list={mobilePresentation}>
        {#each items as item (item.id)}
          <TrackRow
            {item}
            layout="list"
            selected={selectedIds.includes(item.id)}
            playing={item.id === playingId}
            {mobilePresentation}
            on:itemClick={(event) => handleItemClick(event.detail.event, event.detail.id)}
            on:itemDoubleClick={(event) => handleItemDoubleClick(event.detail)}
            on:itemContextMenu={(event) => void handleItemContextMenu(event.detail.event, event.detail.id)}
          />
        {/each}
      </ul>
      {#if queueCount === 0}
        <p class="queue-empty-note">{queueEmptyNote}</p>
      {/if}
    {/if}

    {#if contextMenu}
      <MenuSurface
        items={contextMenuItems}
        x={contextMenu.x}
        y={contextMenu.y}
        ariaLabel={contextMenuAriaLabel}
        on:dismiss={handleWindowDismiss}
        on:action={(event) => handleContextAction(event.detail)}
      />
    {/if}
  </section>
{/if}

<style>
  .queue-panel {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    min-width: 0;
    min-height: 0;
    border-top: 1px solid var(--border-soft);
    background: color-mix(in srgb, var(--bg-elevated) 62%, transparent);
  }

  .queue-panel.is-resizing {
    user-select: none;
  }

  .queue-resizer {
    position: relative;
    flex: 0 0 auto;
    height: 7px;
    cursor: row-resize;
    touch-action: none;
  }

  .queue-resizer::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 3px;
    height: 1px;
    background: var(--border-soft);
  }

  .queue-resizer:hover::before,
  .queue-panel.is-resizing .queue-resizer::before {
    background: var(--accent-strong);
  }

  .queue-resizer-handle {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 3rem;
    height: 3px;
    border-radius: 2px;
    background: var(--border);
  }

  .queue-resizer:hover .queue-resizer-handle,
  .queue-panel.is-resizing .queue-resizer-handle {
    background: var(--accent-strong);
  }

  .queue-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex: 0 0 auto;
    min-height: 1.7rem;
    padding: 0 0.55rem;
    cursor: default;
    color: var(--muted);
  }

  .queue-header:hover {
    color: var(--accent-strong);
  }

  .queue-header-leading {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    min-width: 0;
  }

  .queue-chevron {
    font-size: 0.95rem;
    line-height: 1;
    color: var(--muted);
  }

  .queue-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.02em;
  }

  .queue-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 0.3rem;
    border-radius: 0.6rem;
    background: var(--hover-subtle);
    color: var(--muted);
    font-size: 0.68rem;
    font-weight: 600;
    line-height: 1;
  }

  .queue-clear-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    background: transparent;
    border: 0;
    color: var(--muted);
    transition:
      color 180ms ease,
      background-color 180ms ease;
  }

  .queue-clear-button:hover {
    color: var(--accent-strong);
    background-color: var(--accent-strong-soft);
  }

  .queue-clear-button .material-symbols-outlined {
    font-size: 0.92rem;
    line-height: 1;
  }

  .queue-list {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: 0 0.55rem 0.5rem;
    list-style: none;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .queue-list.mobile-list {
    max-height: 45vh;
    overflow-y: auto;
  }

  .queue-empty-note {
    flex: 1 1 auto;
    margin: 0;
    padding: 0.45rem 0.75rem 0.6rem;
    color: var(--muted);
    font-size: 0.76rem;
  }

  .queue-panel.mobile-presentation .queue-header {
    padding: 0.35rem 0.75rem;
    min-height: 2.2rem;
  }

  .queue-panel.mobile-presentation .queue-list {
    padding: 0 0.75rem 0.6rem;
  }
</style>
