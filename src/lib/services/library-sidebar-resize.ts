import {
  libraryViewSettings,
  LIBRARY_SIDEBAR_MIN_WIDTH,
  LIBRARY_SIDEBAR_MAX_WIDTH
} from '$lib/stores/library-view-settings';

/** Keep the edge drag captured by the separator, including outside the sidebar. */
export function librarySidebarResize(node: HTMLElement) {
  const sidebar = node.parentElement!;
  const container = sidebar.closest<HTMLElement>('.track-list-dropzone')!;
  let pointer: number | null = null;
  let startX = 0;
  let startWidth = 0;

  function setWidth(width: number) {
    const maximum = Math.max(LIBRARY_SIDEBAR_MIN_WIDTH,
      Math.min(LIBRARY_SIDEBAR_MAX_WIDTH, container.getBoundingClientRect().width - 80));
    libraryViewSettings.setSidebarWidth(Math.min(maximum, width));
  }

  function down(event: PointerEvent) {
    if (event.button !== 0 || pointer !== null) return;
    event.preventDefault();
    event.stopPropagation();
    startX = event.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    pointer = event.pointerId;
    node.setPointerCapture(pointer);
    node.classList.add('is-resizing');
  }

  function move(event: PointerEvent) {
    if (event.pointerId === pointer) setWidth(startWidth + event.clientX - startX);
  }

  function end(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    pointer = null;
    node.classList.remove('is-resizing');
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
  }

  function keyboard(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    setWidth(sidebar.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 20 : -20));
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('lostpointercapture', end);
  node.addEventListener('keydown', keyboard);
  return {
    destroy() {
      if (pointer !== null && node.hasPointerCapture(pointer)) node.releasePointerCapture(pointer);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      node.removeEventListener('lostpointercapture', end);
      node.removeEventListener('keydown', keyboard);
      node.classList.remove('is-resizing');
    }
  };
}
