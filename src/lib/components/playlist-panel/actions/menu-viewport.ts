type MenuRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>;

export function getMenuViewportOffset(
  rect: MenuRect,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8,
  anchorLeft?: number
): { x: number; y: number } {
  const availableWidth = Math.max(0, viewportWidth - padding * 2);
  const availableHeight = Math.max(0, viewportHeight - padding * 2);
  const viewportRight = viewportWidth - padding;
  const viewportBottom = viewportHeight - padding;

  const flippedLeft = anchorLeft === undefined ? null : anchorLeft - rect.width - 3;
  const x = rect.width >= availableWidth
    ? padding - rect.left
    : rect.right > viewportRight
      ? flippedLeft !== null && flippedLeft >= padding
        ? flippedLeft - rect.left
        : viewportRight - rect.right
      : rect.left < padding
        ? padding - rect.left
        : 0;
  const y = rect.height >= availableHeight
    ? padding - rect.top
    : rect.bottom > viewportBottom
      ? viewportBottom - rect.bottom
      : rect.top < padding
        ? padding - rect.top
        : 0;

  return { x, y };
}

export function keepMenuInViewport(node: HTMLElement, initiallyEnabled = true) {
  let enabled = initiallyEnabled;
  let animationFrame = 0;

  const updatePosition = () => {
    animationFrame = 0;
    node.style.transform = 'translate(0px, 0px)';
    if (!enabled) {
      return;
    }

    const offset = getMenuViewportOffset(
      node.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
      8,
      node.parentElement?.getBoundingClientRect().left
    );
    node.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  };

  const queuePositionUpdate = () => {
    if (animationFrame === 0) {
      animationFrame = window.requestAnimationFrame(updatePosition);
    }
  };

  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(queuePositionUpdate);

  updatePosition();
  resizeObserver?.observe(node);
  window.addEventListener('resize', queuePositionUpdate);

  return {
    update(nextEnabled = true) {
      enabled = nextEnabled;
      queuePositionUpdate();
    },
    destroy() {
      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', queuePositionUpdate);
    }
  };
}
