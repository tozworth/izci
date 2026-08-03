export interface SwipePoint {
  x: number;
  y: number;
}

export type SwipeDirection = -1 | 1;

export function resolveHorizontalSwipe(
  start: SwipePoint,
  end: SwipePoint,
  minimumDistance = 42
): SwipeDirection | null {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;

  if (Math.abs(deltaX) < minimumDistance || Math.abs(deltaX) < Math.abs(deltaY) * 0.8) {
    return null;
  }

  return deltaX < 0 ? 1 : -1;
}

export function shouldIgnoreSwipeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'input, select, textarea, [role="slider"], [data-mobile-swipe-lock]'
  ));
}
