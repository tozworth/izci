<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MenuActionItem } from '$lib/types';
  import type { ColumnVisibilityAction, PlaylistPanelContextMenu } from './context-menu';
  import type { LibraryPanelColumn } from './library-columns';
  import { portal } from './actions/portal';
  import { windowDismiss } from './actions/window-dismiss';

  export let menu: PlaylistPanelContextMenu | null = null;
  export let panelTitle = 'Playlist';
  export let itemActions: MenuActionItem[] = [];
  export let orderedColumns: LibraryPanelColumn[] = [];
  export let visibleColumnCount = 0;
  export let menuElement: HTMLDivElement | null = null;

  const dispatch = createEventDispatcher<{
    dismiss: void;
    action: string;
    columnToggle: ColumnVisibilityAction;
  }>();
</script>

{#if menu?.kind === 'items'}
  <div
    bind:this={menuElement}
    class="menu-list playlist-context-menu"
    data-menu-interactive="true"
    use:portal
    use:windowDismiss={{ enabled: true, onDismiss: () => dispatch('dismiss') }}
    role="menu"
    aria-label={`${panelTitle} item actions`}
    style={`left: ${menu.x}px; top: ${menu.y}px;`}
  >
    {#each itemActions as action}
      {#if action.separatorBefore}
        <div class="menu-separator" role="separator" aria-hidden="true"></div>
      {/if}
      <button type="button" role="menuitem" on:click={() => dispatch('action', action.id)}>
        <span
          class="material-symbols-outlined menu-item-icon"
          class:favorite-filled={action.icon === 'heart_minus'}
          aria-hidden="true"
        >{action.icon ?? 'label'}</span>
        <span class="menu-item-label">{action.label}</span>
        <span class="menu-item-shortcut" aria-hidden="true">{action.shortcut ?? ''}</span>
      </button>
    {/each}
  </div>
{:else if menu?.kind === 'columns'}
  <div
    bind:this={menuElement}
    class="menu-list playlist-context-menu"
    data-menu-interactive="true"
    use:portal
    use:windowDismiss={{ enabled: true, onDismiss: () => dispatch('dismiss') }}
    role="menu"
    aria-label={`${panelTitle} columns`}
    style={`left: ${menu.x}px; top: ${menu.y}px;`}
  >
    {#each orderedColumns as column}
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={column.visible}
        disabled={column.visible && visibleColumnCount === 1}
        on:click={() => dispatch('columnToggle', { columnId: column.id, visible: column.visible })}
      >
        <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">
          {column.visible ? 'check_box' : 'check_box_outline_blank'}
        </span>
        <span class="menu-item-label">{column.label}</span>
        <span class="menu-item-shortcut" aria-hidden="true"></span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .playlist-context-menu {
    position: fixed;
    z-index: 60;
  }
</style>
