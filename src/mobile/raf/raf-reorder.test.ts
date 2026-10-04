import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectDropBoundary, effectDropIndex, reorderEffect } from './raf-reorder';

afterEach(() => vi.unstubAllGlobals());

function dragFixture() {
  class Handle extends EventTarget {
    captured: number | null = null;
    focus = vi.fn();
    setPointerCapture(id: number) { this.captured = id; }
    hasPointerCapture(id: number) { return this.captured === id; }
    releasePointerCapture() { this.captured = null; }
  }
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handle = new Handle();
  const list = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 192, height: 192 }),
    querySelectorAll: () => [0, 64, 128].map((top) => ({ getBoundingClientRect: () => ({ top, height: 64 }) }))
  } as unknown as HTMLElement;
  const options = { id: 'a', ids: ['a', 'b', 'c'], list, preview: vi.fn(), move: vi.fn() };
  const action = reorderEffect(handle as unknown as HTMLElement, options);
  const pointer = (type: string, y: number) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 7, isPrimary: true, button: 0, clientY: y });
    handle.dispatchEvent(event);
  };
  return { action, handle, options, pointer };
}

describe('mobile Raf insertion targets', () => {
  it('accounts for the source row when dropping above or below it', () => {
    expect(effectDropIndex(0, 3, 4)).toBe(2);
    expect(effectDropIndex(3, 1, 4)).toBe(1);
    expect(effectDropIndex(1, 1, 4)).toBe(1);
    expect(effectDropIndex(1, 2, 4)).toBe(1);
    expect(effectDropIndex(0, 4, 4)).toBe(3);
  });

  it('uses row midpoints and current viewport positions, including scrolled rows', () => {
    const rows = [{ top: -32, height: 64 }, { top: 32, height: 64 }, { top: 96, height: 80 }];
    expect(effectDropBoundary(-1, rows)).toBe(0);
    expect(effectDropBoundary(0, rows)).toBe(1);
    expect(effectDropBoundary(64, rows)).toBe(2);
    expect(effectDropBoundary(136, rows)).toBe(3);
  });

  it('previews touch movement and commits only on release', () => {
    const { action, options, pointer } = dragFixture();
    pointer('pointerdown', 30);
    pointer('pointermove', 190);
    expect(options.preview).toHaveBeenLastCalledWith('a', 3);
    expect(options.move).not.toHaveBeenCalled();
    pointer('pointerup', 190);
    expect(options.move).toHaveBeenCalledExactlyOnceWith('a', 2);
    action.destroy();
  });

  it('abandons cancelled gestures without changing the rack', () => {
    const { action, handle, options, pointer } = dragFixture();
    pointer('pointerdown', 30);
    pointer('pointermove', 190);
    pointer('pointercancel', 190);
    pointer('pointerup', 190);
    expect(options.move).not.toHaveBeenCalled();
    expect(handle.captured).toBeNull();
    expect(options.preview).toHaveBeenLastCalledWith(null, null);
    action.destroy();
  });

  it('abandons the old preview if another window or preset changes the rack', () => {
    const { action, handle, options, pointer } = dragFixture();
    pointer('pointerdown', 30);
    pointer('pointermove', 190);
    action.update({ ...options, ids: ['a', 'c', 'b'] });
    pointer('pointerup', 190);
    expect(options.move).not.toHaveBeenCalled();
    expect(handle.captured).toBeNull();
    action.destroy();
  });

  it('keeps a parameter-only update from cancelling a drag', () => {
    const { action, options, pointer } = dragFixture();
    pointer('pointerdown', 30);
    action.update({ ...options, ids: [...options.ids] });
    pointer('pointerup', 190);
    expect(options.move).toHaveBeenCalledExactlyOnceWith('a', 2);
    action.destroy();
  });
});
