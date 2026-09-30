import { getCurrentWindow } from '@tauri-apps/api/window';
import { readable } from 'svelte/store';

function reportError(error: unknown): void {
  console.error('Desktop window control failed.', error);
}

export const desktopWindowState = readable({ maximized: false, focused: true }, (set) => {
  const window = getCurrentWindow();
  let disposed = false;
  let revision = 0;
  const releases: (() => void)[] = [];

  async function refresh(): Promise<void> {
    const current = ++revision;
    const [maximized, focused] = await Promise.all([window.isMaximized(), window.isFocused()]);
    if (!disposed && current === revision) set({ maximized, focused });
  }

  // Watch native changes as well as reading the initial/restored window state.
  for (const registration of [
    window.onResized(() => { void refresh().catch(reportError); }),
    window.onFocusChanged(() => { void refresh().catch(reportError); })
  ]) {
    void registration.then((release) => {
      if (disposed) release();
      else releases.push(release);
    }).catch(reportError);
  }
  void refresh().catch(reportError);

  return () => {
    disposed = true;
    releases.forEach((release) => release());
  };
});

export function minimizeDesktopWindow(): void {
  void getCurrentWindow().minimize().catch(reportError);
}

export function toggleDesktopMaximize(): void {
  void getCurrentWindow().toggleMaximize().catch(reportError);
}

export function closeDesktopWindow(): void {
  // Use close, preserving the existing CloseRequested / child-window lifecycle.
  void getCurrentWindow().close().catch(reportError);
}

export function desktopTitlebar(node: HTMLElement, enabled: boolean) {
  let unsubscribe: (() => void) | undefined;

  function drag(event: MouseEvent): void {
    if (!enabled || event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest('[data-menu-interactive="true"], button, input, select, textarea, a, [role="button"]')) return;
    event.preventDefault();
    if (event.detail === 2) toggleDesktopMaximize();
    else void getCurrentWindow().startDragging().catch(reportError);
  }

  function update(next: boolean): void {
    enabled = next;
    unsubscribe?.();
    unsubscribe = enabled ? desktopWindowState.subscribe(({ focused }) => {
      node.classList.toggle('desktop-titlebar-inactive', !focused);
    }) : undefined;
    if (!enabled) node.classList.remove('desktop-titlebar-inactive');
  }

  node.addEventListener('mousedown', drag);
  update(enabled);
  return {
    update,
    destroy() {
      unsubscribe?.();
      node.removeEventListener('mousedown', drag);
    }
  };
}
