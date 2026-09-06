import { nowPlayingState, normalizeFlyoutWidth, type FlyoutSide } from '$lib/stores/now-playing-state';

/** Pointer capture keeps the resize owned by its separator and cleans up on unmount. */
export function flyoutResize(node: HTMLElement, side: FlyoutSide) {
  let startX = 0;
  let startWidth = 0;
  let pointer: number | null = null;
  const key = () => side === 'left' ? 'leftWidth' : 'rightWidth';
  function down(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    startX = event.clientX;
    startWidth = node.parentElement!.getBoundingClientRect().width;
    pointer = event.pointerId;
    node.setPointerCapture(pointer);
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    nowPlayingState.update({ [key()]: normalizeFlyoutWidth(startWidth + (event.clientX - startX) * (side === 'left' ? 1 : -1)) });
  }
  function end(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    pointer = null;
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = (event.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1);
    nowPlayingState.update({ [key()]: normalizeFlyoutWidth(nowPlayingState.getSnapshot()[key()] + delta) });
  }
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('keydown', keyboard);
  return { destroy() {
    node.removeEventListener('pointerdown', down);
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', end);
    node.removeEventListener('pointercancel', end);
    node.removeEventListener('keydown', keyboard);
  } };
}
