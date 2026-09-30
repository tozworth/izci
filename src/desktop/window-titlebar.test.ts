import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isMaximized: vi.fn(), isFocused: vi.fn(),
  minimize: vi.fn(async () => undefined), toggleMaximize: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined), startDragging: vi.fn(async () => undefined),
  onResized: vi.fn(), onFocusChanged: vi.fn()
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }));

import {
  desktopWindowState, desktopTitlebar, minimizeDesktopWindow,
  toggleDesktopMaximize, closeDesktopWindow
} from './window-titlebar';

describe('native titlebar', () => {
  const unsubscribers: (() => void)[] = [];
  beforeEach(() => {
    vi.resetAllMocks();
    native.isMaximized.mockResolvedValue(false);
    native.isFocused.mockResolvedValue(true);
    native.onResized.mockResolvedValue(vi.fn());
    native.onFocusChanged.mockResolvedValue(vi.fn());
    for (const command of [native.minimize, native.toggleMaximize, native.close, native.startDragging]) {
      command.mockResolvedValue(undefined);
    }
  });
  afterEach(() => {
    unsubscribers.splice(0).forEach((release) => release());
    vi.unstubAllGlobals();
  });

  it('tracks native maximize/focus changes and discards older asynchronous reads', async () => {
    const states: { maximized: boolean; focused: boolean }[] = [];
    unsubscribers.push(desktopWindowState.subscribe((state) => states.push(state)));
    await vi.waitFor(() => expect(states).toHaveLength(2));

    let finishOldRead!: (value: boolean) => void;
    native.isMaximized.mockReturnValueOnce(new Promise<boolean>((resolve) => { finishOldRead = resolve; }));
    native.onResized.mock.calls[0][0]();
    native.isMaximized.mockResolvedValue(true);
    native.isFocused.mockResolvedValue(false);
    native.onFocusChanged.mock.calls[0][0]();
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ maximized: true, focused: false }));
    finishOldRead(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).toEqual({ maximized: true, focused: false });
  });

  it('releases listeners that finish registering after the titlebar is removed', async () => {
    let finishRegistration!: (release: () => void) => void;
    const lateRelease = vi.fn();
    const focusRelease = vi.fn();
    native.onResized.mockReturnValue(new Promise((resolve) => { finishRegistration = resolve; }));
    native.onFocusChanged.mockResolvedValue(focusRelease);
    const unsubscribe = desktopWindowState.subscribe(() => undefined);
    await Promise.resolve();
    unsubscribe();
    finishRegistration(lateRelease);
    await Promise.resolve();
    expect(lateRelease).toHaveBeenCalledOnce();
    expect(focusRelease).toHaveBeenCalledOnce();
  });

  it('uses native close and window controls', () => {
    minimizeDesktopWindow();
    toggleDesktopMaximize();
    closeDesktopWindow();
    expect(native.minimize).toHaveBeenCalledOnce();
    expect(native.toggleMaximize).toHaveBeenCalledOnce();
    expect(native.close).toHaveBeenCalledOnce();
  });

  it('drags only noninteractive titlebar space and maximizes on a double press', () => {
    class Target {
      constructor(private interactive = false) {}
      closest() { return this.interactive ? this : null; }
    }
    vi.stubGlobal('Element', Target);
    const node = {
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      classList: { toggle: vi.fn(), remove: vi.fn() }
    };
    const action = desktopTitlebar(node as unknown as HTMLElement, true);
    const drag = node.addEventListener.mock.calls[0][1];
    drag({ target: new Target(true), button: 0, detail: 1 });
    drag({ target: new Target(), button: 2, detail: 1 });
    expect(native.startDragging).not.toHaveBeenCalled();
    drag({ target: new Target(), button: 0, detail: 1, preventDefault: vi.fn() });
    expect(native.startDragging).toHaveBeenCalledOnce();
    drag({ target: new Target(), button: 0, detail: 2, preventDefault: vi.fn() });
    expect(native.toggleMaximize).toHaveBeenCalledOnce();
    action.update(false);
    drag({ target: new Target(), button: 0, detail: 1 });
    expect(native.startDragging).toHaveBeenCalledOnce();
    action.destroy();
    expect(node.removeEventListener).toHaveBeenCalledWith('mousedown', drag);
  });
});
