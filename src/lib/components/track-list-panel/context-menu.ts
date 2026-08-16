import { libraryViewSettings } from '$lib/stores/library-view-settings';
import { buildLibraryGroupContextActions } from '$lib/services/workspace-actions';
import type { TranslationOptions } from '$lib/i18n';
import type { LibraryGroupViewId, MenuActionItem, TrackSelection } from '$lib/types';
import type { LibraryGroup } from './library-views';

export type TrackListPanelContextMenu =
  | {
      kind: 'items';
      x: number;
      y: number;
      ids: string[];
    }
  | {
      kind: 'panel';
      x: number;
      y: number;
    }
  | {
      kind: 'library-group';
      x: number;
      y: number;
      ids: string[];
      view: LibraryGroupViewId;
      key: string;
      pinned: boolean;
    };

type Translate = (id: string, options?: TranslationOptions) => string;

export function getContextMenuActionLabel(action: MenuActionItem, translate: Translate): string {
  switch (action.id) {
    case 'go-to-library': return translate('queue.actions.goTo', { default: 'Go to...' });
    case 'go-to-library-artist': return translate('library.columns.artist', { default: 'Artist' });
    case 'go-to-library-album': return translate('main.trackDetails.album', { default: 'Album' });
    case 'go-to-library-genre': return translate('main.trackDetails.genre', { default: 'Genre' });
    case 'go-to-library-year': return translate('main.trackDetails.year', { default: 'Year' });
    case 'go-to-library-format': return translate('main.trackDetails.format', { default: 'Format' });
    case 'track-details': return translate('queue.actions.trackDetails', { default: 'Track details' });
    case 'play-next': return translate('queue.actions.playNext', { default: 'Play next' });
    case 'add-to-up-next': return translate('queue.actions.addToUpNext', { default: 'Add to up next' });
    case 'toggle-library': return action.icon === 'remove_circle'
      ? translate('queue.actions.removeFromLibrary', { default: 'Remove from library' })
      : translate('queue.actions.addToLibrary', { default: 'Add to library' });
    case 'toggle-favorite': return action.icon === 'heart_minus'
      ? translate('queue.actions.removeFromFavorites', { default: 'Remove from favorites' })
      : translate('queue.actions.addToFavorites', { default: 'Add to favorites' });
    case 'rate': return translate('queue.actions.rate', { default: 'Rate' });
    case 'rate:clear': return translate('queue.actions.clearRating', { default: 'Clear rating' });
    case 'separate-subsongs': return translate('queue.actions.separateSubsongs', { default: 'Separate subsongs' });
    case 'add-to-queue': return translate('queue.actions.addToQueue', { default: 'Add to queue' });
    case 'replace-queue': return translate('queue.actions.replaceQueue', { default: 'Replace queue' });
    case 'shuffle-play': return translate('queue.actions.shufflePlay', { default: 'Shuffle play' });
    case 'reset-play-count': return translate('queue.actions.resetPlayCount', { default: 'Reset play count' });
    case 'copy-filename': return translate('queue.actions.copyFilename', { default: 'Copy filename' });
    case 'randomize-queue': return translate('queue.actions.randomize', { default: 'Randomize' });
    case 'remove-favorite': return translate('queue.actions.removeFromFavorites', { default: 'Remove from favorites' });
    case 'remove': return translate('queue.actions.remove', { default: 'Remove' });
    default: return action.label;
  }
}

export function getContextMenuShortcut(shortcut: string | undefined, translate: Translate): string | undefined {
  return shortcut === 'Delete'
    ? translate('queue.shortcuts.delete', { default: 'Delete' })
    : shortcut;
}

export function localizeContextMenuAction(action: MenuActionItem, translate: Translate): MenuActionItem {
  return {
    ...action,
    label: getContextMenuActionLabel(action, translate),
    shortcut: getContextMenuShortcut(action.shortcut, translate),
    children: action.children?.map((child) => localizeContextMenuAction(child, translate))
  };
}

export function buildPanelContextMenuItems(translate: Translate): MenuActionItem[] {
  return [
    {
      id: 'randomize-queue',
      label: translate('queue.actions.randomize', { default: 'Randomize' }),
      icon: 'shuffle'
    } satisfies MenuActionItem
  ];
}

export function buildContextMenuActions(
  menu: TrackListPanelContextMenu | null,
  getActions: (ids: string[]) => MenuActionItem[],
  translate: Translate
): MenuActionItem[] {
  if (!menu) return [];

  if (menu.kind === 'panel') {
    return buildPanelContextMenuItems(translate);
  }

  const actions = getActions(menu.ids);
  return menu.kind === 'library-group'
    ? buildLibraryGroupContextActions(actions)
    : actions;
}

export function buildContextMenuItems(
  menu: TrackListPanelContextMenu | null,
  actions: MenuActionItem[],
  translate: Translate
): MenuActionItem[] {
  if (!menu) return [];

  const pinActions = menu.kind === 'library-group' && menu.view !== 'folders'
    ? [{
        id: menu.pinned ? 'unpin-library-group' : 'pin-library-group',
        label: menu.pinned
          ? translate('library.unpin', { default: 'Unpin' })
          : translate('library.pinToTop', { default: 'Pin to top' }),
        icon: menu.pinned ? 'keep_off' : 'keep'
      } satisfies MenuActionItem]
    : [];

  return [
    ...pinActions,
    ...actions.map((action, index) => {
      const localizedAction = localizeContextMenuAction(action, translate);

      return {
        ...localizedAction,
        separatorBefore: menu.kind === 'library-group' && menu.view !== 'folders' && index === 0
          ? true
          : localizedAction.separatorBefore
      };
    })
  ];
}

export function getContextMenuAriaLabel(
  menu: TrackListPanelContextMenu | null,
  panelLabel: string,
  translate: Translate
): string {
  return menu?.kind === 'library-group'
    ? translate('queue.contextMenu.libraryGroupActions', { default: 'Library group actions' })
    : menu?.kind === 'panel'
      ? translate('queue.contextMenu.panelActions', { default: 'Queue actions' })
      : translate('queue.contextMenu.itemActions', { default: '{panel} item actions', values: { panel: panelLabel } });
}

export function buildPanelContextMenu(
  event: MouseEvent,
  readOnly: boolean,
  libraryMode: boolean,
  checkClosestTarget: boolean
): TrackListPanelContextMenu | null {
  if (readOnly || libraryMode) return null;

  if (checkClosestTarget) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-track-id], .clv-columns-header, .clv-column-header, .panel-header')) {
      return null;
    }
  }

  event.preventDefault();
  return {
    kind: 'panel',
    x: event.clientX,
    y: event.clientY
  };
}

export function buildItemContextMenu(
  event: MouseEvent,
  id: string,
  deps: {
    readOnly: boolean;
    layout: 'list' | 'columns';
    displaySelectedIds: string[];
    onSetSelection: (selection: TrackSelection) => void;
    onSelect: (detail: { id: string; range: boolean; toggle: boolean }) => void;
  }
): TrackListPanelContextMenu | null {
  if (deps.readOnly) return null;
  event.preventDefault();

  const itemIsSelected = deps.displaySelectedIds.includes(id);

  if (!itemIsSelected) {
    if (deps.layout === 'columns') {
      deps.onSetSelection({
        ids: [id],
        anchorId: id,
        focusId: id
      });
    } else {
      deps.onSelect({
        id,
        range: false,
        toggle: false
      });
    }
  }

  return {
    kind: 'items',
    x: event.clientX,
    y: event.clientY,
    ids: itemIsSelected ? deps.displaySelectedIds : [id]
  };
}

export function buildLibraryGroupContextMenu(
  event: MouseEvent,
  key: string,
  deps: {
    groupView: LibraryGroupViewId | null;
    libraryGroups: LibraryGroup[];
    pinnedKeys: string[];
    onSetSelection: (selection: TrackSelection) => void;
  }
): TrackListPanelContextMenu | null {
  event.preventDefault();

  if (!deps.groupView) {
    return null;
  }

  const group = deps.libraryGroups.find((entry) => entry.key === key);

  if (!group) {
    return null;
  }

  const ids = group.items.map((item) => item.id);
  deps.onSetSelection({
    ids,
    anchorId: ids[0] ?? null,
    focusId: ids[0] ?? null
  });

  return {
    kind: 'library-group',
    x: event.clientX,
    y: event.clientY,
    ids,
    view: deps.groupView,
    key,
    pinned: deps.pinnedKeys.includes(key)
  };
}

export function buildContextActionEvent(
  menu: TrackListPanelContextMenu | null,
  actionId: string
): { actionId: string; ids: string[] } | null {
  if (
    !menu
    || (menu.kind !== 'items'
      && menu.kind !== 'library-group'
      && menu.kind !== 'panel')
  ) {
    return null;
  }

  return {
    actionId,
    ids: menu.kind === 'items' || menu.kind === 'library-group'
      ? menu.ids
      : []
  };
}

export function handleMenuAction(
  menu: TrackListPanelContextMenu | null,
  actionId: string,
  onContextAction: (event: { actionId: string; ids: string[] }) => void,
  onClose: () => void
): void {
  if (menu?.kind === 'library-group' && actionId === 'pin-library-group') {
    libraryViewSettings.pinGroup(menu.view, menu.key);
    onClose();
    return;
  }

  if (menu?.kind === 'library-group' && actionId === 'unpin-library-group') {
    libraryViewSettings.unpinGroup(menu.view, menu.key);
    onClose();
    return;
  }

  const event = buildContextActionEvent(menu, actionId);
  if (!event) return;
  onContextAction(event);
  onClose();
}
