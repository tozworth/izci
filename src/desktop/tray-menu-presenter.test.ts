import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presentTrayMenu } from './tray-menu-presenter';

const native = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

describe('tray popup presentation', () => {
  let contentChanged: () => void;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('screen', { availWidth: 1920, availHeight: 1040 });
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { contentChanged = callback; }
      observe() {} disconnect() {}
    });
  });

  afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals(); });

  async function flushUpdates(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function menu() {
    return {
      width: 180, height: 200,
      getBoundingClientRect() { return { width: this.width, height: this.height }; },
      style: { setProperty: vi.fn(), removeProperty: vi.fn() }, focus: vi.fn()
    };
  }

  it('shows a hidden popup before any animation frames can run', async () => {
    dispose = presentTrayMenu(menu() as unknown as HTMLElement).destroy;
    // WebView2 disables rendering between opens. No frame or ResizeObserver
    // callback can be relied on to get the native popup onto the screen.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(native.invoke).toHaveBeenCalledWith('show_desktop_tray_menu', { width: 192, height: 212 });
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('grows for long Raf lists beyond the old viewport, then shrinks when returning', async () => {
    const node = menu();
    dispose = presentTrayMenu(node as unknown as HTMLElement).destroy;
    await flushUpdates();
    expect(native.invoke).toHaveBeenLastCalledWith('show_desktop_tray_menu', { width: 192, height: 212 });
    node.height = 1200;
    contentChanged();
    await flushUpdates();
    expect(native.invoke).toHaveBeenLastCalledWith('show_desktop_tray_menu', { width: 192, height: 1000 });
    contentChanged();
    await flushUpdates();
    expect(native.invoke).toHaveBeenCalledTimes(2);
    node.height = 200;
    contentChanged();
    await flushUpdates();
    expect(native.invoke).toHaveBeenLastCalledWith('show_desktop_tray_menu', { width: 192, height: 212 });
    expect(node.focus).toHaveBeenCalledTimes(1);
  });

  it('rounds fractional menu bounds up instead of clipping them at high DPI', async () => {
    const node = menu();
    node.width = 180.25;
    node.height = 232.6875;
    dispose = presentTrayMenu(node as unknown as HTMLElement).destroy;
    await flushUpdates();
    expect(native.invoke).toHaveBeenLastCalledWith('show_desktop_tray_menu', { width: 193, height: 245 });
    expect(node.style.setProperty).toHaveBeenCalledWith('max-height', 'none', 'important');
    expect(node.style.removeProperty).toHaveBeenCalledWith('max-height');
  });

  it('does not reopen a dismissed popup when fonts finish loading', async () => {
    let finishFonts!: () => void;
    vi.stubGlobal('document', { fonts: { ready: new Promise<void>((resolve) => { finishFonts = resolve; }) } });
    const node = menu();
    dispose = presentTrayMenu(node as unknown as HTMLElement).destroy;
    await flushUpdates();
    dispose(); dispose = undefined;
    finishFonts();
    await Promise.resolve();
    expect(native.invoke).not.toHaveBeenCalled();
    expect(node.focus).not.toHaveBeenCalled();
  });
});
