import { describe, expect, it } from 'vitest';

import { clampContextMenuPosition } from './context-menu';

describe('playlist-panel context menu helpers', () => {
  it('leaves missing menus or elements unchanged', () => {
    const menu = { kind: 'columns' as const, x: 50, y: 60 };

    expect(clampContextMenuPosition(null, null, 100, 100)).toBeNull();
    expect(clampContextMenuPosition(menu, null, 100, 100)).toBe(menu);
  });

  it('clamps menu coordinates into the padded viewport', () => {
    const element = {
      offsetWidth: 80,
      offsetHeight: 50
    } as HTMLElement;

    expect(
      clampContextMenuPosition({ kind: 'items', x: 500, y: -20, ids: ['a'] }, element, 200, 120)
    ).toEqual({
      kind: 'items',
      x: 112,
      y: 8,
      ids: ['a']
    });
  });
});
