import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitDesktopTitlebar } from './titlebar-overflow';

afterEach(() => vi.unstubAllGlobals());

describe('desktop titlebar overflow', () => {
  function setup() {
    const classes = new Set<string>();
    const resize = { observe: vi.fn(), disconnect: vi.fn() };
    const mutation = { observe: vi.fn(), disconnect: vi.fn() };
    let resized!: () => void;
    let changed!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; return resize; }
    });
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { changed = callback; return mutation; }
    });
    const menu = { getBoundingClientRect: () => ({ width: 40 }) };
    let titleWidth = 32;
    const brand = { children: [
      { getBoundingClientRect: () => ({ width: titleWidth }) },
      { getBoundingClientRect: () => ({ width: 32 }) }
    ] };
    const mini = {};
    const buttons = [mini, {}, {}, {}];
    vi.stubGlobal('getComputedStyle', (node: unknown) => node === brand
      ? { columnGap: '8px' } : { width: '40px' });
    const bar = {
      clientWidth: 272,
      querySelector: (selector: string) => selector === '.menu-brand' ? brand : menu,
      querySelectorAll: () => [menu, ...brand.children, ...buttons],
      classList: {
        toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
        remove: (...names: string[]) => names.forEach((name) => classes.delete(name))
      }
    };
    const controls = { closest: () => bar, children: buttons, querySelector: () => mini };
    const action = fitDesktopTitlebar(controls as unknown as HTMLElement)!;
    return { bar, classes, resize, mutation, resized, changed, action,
      setTitleWidth: (width: number) => { titleWidth = width; } };
  }

  it('culls the brand before the mini player, and restores both as space returns', () => {
    const state = setup();
    expect([...state.classes]).toEqual([]);
    state.bar.clientWidth = 271;
    state.resized();
    expect([...state.classes]).toEqual(['desktop-titlebar-hide-brand']);
    state.bar.clientWidth = 199;
    state.resized();
    expect(state.classes.has('desktop-titlebar-hide-mini')).toBe(true);
    // Re-measuring hidden controls must not make them reappear and overflow.
    state.resized();
    expect(state.classes.has('desktop-titlebar-hide-mini')).toBe(true);
    state.bar.clientWidth = 200;
    state.resized();
    expect([...state.classes]).toEqual(['desktop-titlebar-hide-brand']);
    state.bar.clientWidth = 272;
    state.resized();
    expect([...state.classes]).toEqual([]);
    state.action.destroy();
  });

  it('rechecks changed content and releases observers on removal', () => {
    const state = setup();
    state.setTitleWidth(64);
    state.changed();
    expect(state.classes.has('desktop-titlebar-hide-brand')).toBe(true);
    state.action.destroy();
    expect(state.resize.disconnect).toHaveBeenCalled();
    expect(state.mutation.disconnect).toHaveBeenCalledOnce();
    expect([...state.classes]).toEqual([]);
  });

  it('leaves non-menu titlebars alone', () => {
    expect(fitDesktopTitlebar({ closest: () => null } as unknown as HTMLElement)).toBeUndefined();
  });
});
