<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
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

  function getActionLabel(action: MenuActionItem): string {
    switch (action.id) {
      case 'track-details': return $t('playlist.actions.trackDetails', { default: 'Track details' });
      case 'toggle-library': return action.icon === 'remove_circle'
        ? $t('playlist.actions.removeFromLibrary', { default: 'Remove from library' })
        : $t('playlist.actions.addToLibrary', { default: 'Add to library' });
      case 'toggle-favorite': return action.icon === 'heart_minus'
        ? $t('playlist.actions.removeFromFavorites', { default: 'Remove from favorites' })
        : $t('playlist.actions.addToFavorites', { default: 'Add to favorites' });
      case 'separate-subsongs': return $t('playlist.actions.separateSubsongs', { default: 'Separate subsongs' });
      case 'add-to-playlist': return $t('playlist.actions.addToPlaylist', { default: 'Add to playlist' });
      case 'replace-playlist': return $t('playlist.actions.replacePlaylist', { default: 'Replace playlist' });
      case 'reset-play-count': return $t('playlist.actions.resetPlayCount', { default: 'Reset play count' });
      case 'remove-favorite': return $t('playlist.actions.removeFromFavorites', { default: 'Remove from favorites' });
      case 'remove': return $t('playlist.actions.remove', { default: 'Remove' });
      default: return action.label;
    }
  }

  function getShortcutLabel(shortcut: string | undefined): string {
    return shortcut === 'Delete'
      ? $t('playlist.shortcuts.delete', { default: 'Delete' })
      : shortcut ?? '';
  }
</script>

{#if menu?.kind === 'items'}
  <div
    bind:this={menuElement}
    class="menu-list playlist-context-menu"
    data-menu-interactive="true"
    use:portal
    use:windowDismiss={{ enabled: true, onDismiss: () => dispatch('dismiss') }}
    role="menu"
    aria-label={$t('playlist.contextMenu.itemActions', { default: '{panel} item actions', values: { panel: panelTitle } })}
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
        <span class="menu-item-label">{getActionLabel(action)}</span>
        <span class="menu-item-shortcut" aria-hidden="true">{getShortcutLabel(action.shortcut)}</span>
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
    aria-label={$t('playlist.contextMenu.columns', { default: '{panel} columns', values: { panel: panelTitle } })}
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
