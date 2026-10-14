import { invoke } from '@tauri-apps/api/core';

// The tray popup is a separate native window. Resize it when switching between
// its command list and the shared Raf menu, including live preset/locale edits.
export function presentTrayMenu(node: HTMLElement) {
  let disposed = false;
  let scheduled = false;
  let lastSize = '';
  let focused = false;

  async function present(): Promise<void> {
    await document.fonts.ready;
    if (disposed) return;
    const maxHeight = Math.min(988, screen.availHeight - 12);
    node.style.setProperty('--tray-menu-max-height', `${maxHeight}px`);
    node.style.setProperty('--tray-menu-max-width', `${Math.min(788, screen.availWidth - 12)}px`);
    const width = node.offsetWidth + 12;
    // Measure the full contents even while CSS fits the previous native size.
    const height = Math.min(node.scrollHeight + node.offsetHeight - node.clientHeight, maxHeight) + 12;
    const size = `${width}:${height}`;
    if (size === lastSize) return;
    lastSize = size;
    await invoke('show_desktop_tray_menu', { width, height });
    if (!disposed && !focused) {
      focused = true;
      node.focus({ preventScroll: true });
    }
  }
  function schedule(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    // Hidden tray controllers stop rendering. Waiting for a frame here would
    // prevent the native show command that enables rendering in the first place.
    queueMicrotask(() => {
      scheduled = false;
      void present().catch(console.error);
    });
  }
  const observer = new ResizeObserver(schedule);
  observer.observe(node);
  const contents = new MutationObserver(schedule);
  contents.observe(node, { childList: true, subtree: true, characterData: true });
  schedule();
  return {
    destroy() {
      disposed = true;
      observer.disconnect();
      contents.disconnect();
    }
  };
}
