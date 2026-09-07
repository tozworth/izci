import { describe, expect, it } from 'vitest';
import type { MenuActionItem } from '$lib/types';
import {
  buildContextActionEvent,
  buildContextMenuActions,
  buildContextMenuItems,
  buildItemContextMenu,
  getContextMenuActionLabel,
  getContextMenuShortcut,
  localizeContextMenuAction
} from './context-menu';
import type { TrackListPanelContextMenu } from './context-menu';

const translate = (
  id: string,
  options?: { default?: string; values?: Record<string, string | number | boolean | Date | null | undefined> }
): string => options?.default ?? id;

const getActions: (ids: string[]) => MenuActionItem[] = () => [
  { id: 'remove', label: 'Remove', icon: 'delete' }
];

describe('context menu action labels', () => {
  it('localizes known ids and falls back to the action label', () => {
    expect(getContextMenuActionLabel({ id: 'remove', label: 'Remove', icon: 'delete' }, translate)).toBe('Remove');
    expect(getContextMenuActionLabel({ id: 'play-next', label: 'Play next', icon: 'playlist_play' }, translate)).toBe('Play next');
    expect(getContextMenuActionLabel({ id: 'custom-action', label: 'Custom', icon: 'star' }, translate)).toBe('Custom');
  });

  it('localizes toggle actions by icon', () => {
    expect(getContextMenuActionLabel({ id: 'toggle-library', label: 'Toggle', icon: 'remove_circle' }, translate)).toBe('Remove from library');
    expect(getContextMenuActionLabel({ id: 'toggle-library', label: 'Toggle', icon: 'library_add' }, translate)).toBe('Add to library');
    expect(getContextMenuActionLabel({ id: 'toggle-favorite', label: 'Toggle', icon: 'heart_minus' }, translate)).toBe('Remove from favorites');
    expect(getContextMenuActionLabel({ id: 'toggle-favorite', label: 'Toggle', icon: 'heart_plus' }, translate)).toBe('Add to favorites');
  });

  it('localizes the Delete shortcut and passes others through', () => {
    expect(getContextMenuShortcut('Delete', translate)).toBe('Delete');
    expect(getContextMenuShortcut('Ctrl+A', translate)).toBe('Ctrl+A');
    expect(getContextMenuShortcut(undefined, translate)).toBeUndefined();
  });

  it('localizes nested children recursively', () => {
    const localized = localizeContextMenuAction({
      id: 'go-to-library',
      label: 'Go to...',
      icon: 'explore',
      children: [{ id: 'go-to-library-artist', label: 'Artist', icon: 'person' }]
    }, translate);

    expect(localized.label).toBe('Go to...');
    expect(localized.children?.[0].label).toBe('Artist');
  });
});

describe('buildContextMenuItems', () => {
  it('returns an empty list for a closed menu', () => {
    expect(buildContextMenuItems(null, getActions([]), translate)).toEqual([]);
  });

  it('builds the panel menu from the panel action template', () => {
    const menu: TrackListPanelContextMenu = { kind: 'panel', x: 10, y: 10 };
    const actions = buildContextMenuActions(menu, getActions, translate);
    const items = buildContextMenuItems(menu, actions, translate);

    expect(actions).toEqual([
      expect.objectContaining({ id: 'randomize-queue', icon: 'shuffle', label: 'Randomize' })
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'randomize-queue', icon: 'shuffle', label: 'Randomize' });
  });

  it('localizes item actions and keeps separators', () => {
    const menu: TrackListPanelContextMenu = { kind: 'items', x: 10, y: 10, ids: ['a'] };
    const items = buildContextMenuItems(menu, buildContextMenuActions(menu, getActions, translate), translate);

    expect(items).toEqual([
      expect.objectContaining({ id: 'remove', label: 'Remove' })
    ]);
  });

  it('prepends a pin action for non-folder library groups', () => {
    const menu: TrackListPanelContextMenu = {
      kind: 'library-group',
      x: 10,
      y: 10,
      ids: ['a'],
      view: 'albums',
      key: 'albums:album\u0000artist',
      pinned: false
    };
    const items = buildContextMenuItems(menu, buildContextMenuActions(menu, getActions, translate), translate);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'pin-library-group', icon: 'keep', label: 'Pin to top' });
    expect(items[1]).toMatchObject({ id: 'remove', separatorBefore: true });
  });

  it('uses the unpin action for pinned groups', () => {
    const menu: TrackListPanelContextMenu = {
      kind: 'library-group',
      x: 10,
      y: 10,
      ids: ['a'],
      view: 'albums',
      key: 'albums:album\u0000artist',
      pinned: true
    };
    const items = buildContextMenuItems(menu, buildContextMenuActions(menu, getActions, translate), translate);

    expect(items[0]).toMatchObject({ id: 'unpin-library-group', icon: 'keep_off', label: 'Unpin' });
  });

  it('omits the pin action for the folders view', () => {
    const menu: TrackListPanelContextMenu = {
      kind: 'library-group',
      x: 10,
      y: 10,
      ids: ['a'],
      view: 'folders',
      key: 'folders:Music',
      pinned: false
    };
    const items = buildContextMenuItems(menu, buildContextMenuActions(menu, getActions, translate), translate);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'remove' });
  });
});

describe('buildContextActionEvent', () => {
  it('returns null for a closed menu', () => {
    expect(buildContextActionEvent(null, 'remove')).toBeNull();
  });

  it('carries ids for item and library-group menus', () => {
    expect(buildContextActionEvent({ kind: 'items', x: 0, y: 0, ids: ['a', 'b'] }, 'remove'))
      .toEqual({ actionId: 'remove', ids: ['a', 'b'] });
    expect(buildContextActionEvent({
      kind: 'library-group',
      x: 0,
      y: 0,
      ids: ['a'],
      view: 'albums',
      key: 'k',
      pinned: false
    }, 'remove')).toEqual({ actionId: 'remove', ids: ['a'] });
  });

  it('sends empty ids for panel menus', () => {
    expect(buildContextActionEvent({ kind: 'panel', x: 0, y: 0 }, 'randomize-queue'))
      .toEqual({ actionId: 'randomize-queue', ids: [] });
  });
});

describe('buildItemContextMenu', () => {
  it('allows safe item actions on read-only multiplayer collections', () => {
    let prevented = false;
    const menu = buildItemContextMenu({
      clientX: 12,
      clientY: 34,
      preventDefault: () => { prevented = true; }
    } as MouseEvent, 'track', {
      readOnly: true,
      layout: 'list',
      displaySelectedIds: ['track'],
      onSetSelection: () => undefined,
      onSelect: () => undefined
    });

    expect(prevented).toBe(true);
    expect(menu).toEqual({ kind: 'items', x: 12, y: 34, ids: ['track'] });
  });
});
