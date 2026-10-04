export function effectDropIndex(sourceIndex: number, boundary: number, count: number): number {
  return Math.max(0, Math.min(count - 1, boundary > sourceIndex ? boundary - 1 : boundary));
}

export function effectDropBoundary(y: number, rows: readonly { top: number; height: number }[]): number {
  const index = rows.findIndex((row) => y < row.top + row.height / 2);
  return index < 0 ? rows.length : index;
}

interface ReorderOptions {
  id: string;
  list: HTMLElement;
  ids: string[];
  preview: (id: string | null, boundary: number | null) => void;
  move: (id: string, index: number) => void;
}

// Pointer capture works for touch and mouse; native HTML drag/drop does not on phones.
// Keep previews transient and commit one store change when the handle is released.
export function reorderEffect(node: HTMLElement, initial: ReorderOptions) {
  let options = initial;
  let drag: { pointerId: number; y: number; boundary: number; ids: string[] } | null = null;
  let frame = 0;

  function cancel() {
    const pointerId = drag?.pointerId;
    drag = null;
    cancelAnimationFrame(frame);
    frame = 0;
    if (pointerId !== undefined && node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
    options.preview(null, null);
  }

  function preview() {
    if (!drag) return;
    const rows = Array.from(options.list.querySelectorAll<HTMLElement>('[data-raf-effect-row]'));
    drag.boundary = effectDropBoundary(drag.y, rows.map((row) => row.getBoundingClientRect()));
    options.preview(options.id, drag.boundary);
  }

  function scroll() {
    if (!drag) return;
    const rect = options.list.getBoundingClientRect();
    const edge = Math.min(48, rect.height / 3);
    const delta = drag.y < rect.top + edge
      ? -Math.min(12, (rect.top + edge - drag.y) / 4)
      : drag.y > rect.bottom - edge ? Math.min(12, (drag.y - rect.bottom + edge) / 4) : 0;
    if (delta) {
      options.list.scrollTop += delta;
      preview();
    }
    frame = requestAnimationFrame(scroll);
  }

  function start(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || drag) return;
    event.preventDefault();
    node.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, y: event.clientY, boundary: 0, ids: [...options.ids] };
    node.setPointerCapture(event.pointerId);
    preview();
    frame = requestAnimationFrame(scroll);
  }

  function updatePointer(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.y = event.clientY;
    preview();
  }

  function finish(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    updatePointer(event);
    const sourceIndex = options.ids.indexOf(options.id);
    const targetIndex = effectDropIndex(sourceIndex, drag.boundary, options.ids.length);
    cancel();
    if (sourceIndex >= 0 && sourceIndex !== targetIndex) options.move(options.id, targetIndex);
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const index = options.ids.indexOf(options.id);
    if (index >= 0) options.move(options.id, Math.max(0, Math.min(options.ids.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1))));
  }

  node.addEventListener('pointerdown', start);
  node.addEventListener('pointermove', updatePointer);
  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('lostpointercapture', cancel);
  node.addEventListener('keydown', keydown);
  window.addEventListener('blur', cancel);

  return {
    update(next: ReorderOptions) {
      options = next;
      // A preset switch or a remote rack mutation invalidates the insertion preview.
      if (drag && (drag.ids.length !== next.ids.length || drag.ids.some((id, index) => id !== next.ids[index]))) cancel();
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', start);
      node.removeEventListener('pointermove', updatePointer);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('lostpointercapture', cancel);
      node.removeEventListener('keydown', keydown);
      window.removeEventListener('blur', cancel);
    }
  };
}
