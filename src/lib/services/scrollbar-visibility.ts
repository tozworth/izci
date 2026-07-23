const ACTIVE_CLASS = 'izci-scrollbar-active';
const NEAR_CLASS = 'izci-scrollbar-near';
const EDGE_DISTANCE_PX = 18;
const ACTIVE_DURATION_MS = 850;
const MOTION_DURATION_MS = 180;
const VISIBILITY_PROPERTY = '--izci-scrollbar-visibility';

type ScrollAxis = 'horizontal' | 'vertical';

function isScrollable(element: HTMLElement, axis: ScrollAxis): boolean {
  const styles = getComputedStyle(element);
  const overflow = axis === 'vertical' ? styles.overflowY : styles.overflowX;
  if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') return false;

  return axis === 'vertical'
    ? element.scrollHeight > element.clientHeight
    : element.scrollWidth > element.clientWidth;
}

function elementPath(event: Event): HTMLElement[] {
  return event.composedPath().filter((entry): entry is HTMLElement => entry instanceof HTMLElement);
}

function findWheelScroller(event: WheelEvent): HTMLElement | null {
  const path = elementPath(event);
  const primaryAxis: ScrollAxis = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? 'horizontal'
    : 'vertical';
  const primaryDelta = primaryAxis === 'vertical' ? event.deltaY : event.deltaX;
  const primaryCandidates = path.filter((element) => isScrollable(element, primaryAxis));
  const movingCandidate = primaryCandidates.find((element) => {
    const position = primaryAxis === 'vertical' ? element.scrollTop : element.scrollLeft;
    const extent = primaryAxis === 'vertical'
      ? element.scrollHeight - element.clientHeight
      : element.scrollWidth - element.clientWidth;

    return primaryDelta < 0 ? position > 0 : position < extent;
  });

  return movingCandidate
    ?? primaryCandidates[0]
    ?? path.find((element) => isScrollable(element, primaryAxis === 'vertical' ? 'horizontal' : 'vertical'))
    ?? null;
}

function findNearbyScroller(event: PointerEvent): HTMLElement | null {
  for (const element of elementPath(event)) {
    const rect = element.getBoundingClientRect();
    const nearVerticalEdge = isScrollable(element, 'vertical')
      && event.clientX >= rect.right - EDGE_DISTANCE_PX;
    const nearHorizontalEdge = isScrollable(element, 'horizontal')
      && event.clientY >= rect.bottom - EDGE_DISTANCE_PX;

    if (nearVerticalEdge || nearHorizontalEdge) return element;
  }

  return null;
}

export function initializeScrollbarVisibility(): () => void {
  const activeTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const visibilityAnimations = new Map<HTMLElement, Animation>();
  const coarsePointer = matchMedia('(pointer: coarse)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let nearbyScroller: HTMLElement | null = null;

  function isVisible(element: HTMLElement): boolean {
    return element.classList.contains(ACTIVE_CLASS) || element.classList.contains(NEAR_CLASS);
  }

  function setVisibilityFlag(element: HTMLElement, className: string, enabled: boolean): void {
    const wasVisible = isVisible(element);
    const currentVisibility = Number.parseFloat(getComputedStyle(element).getPropertyValue(VISIBILITY_PROPERTY)) || 0;
    element.classList.toggle(className, enabled);
    const visible = isVisible(element);
    if (wasVisible === visible) return;

    visibilityAnimations.get(element)?.cancel();
    if (reducedMotion.matches) return;
    const targetVisibility = visible ? 1 : 0;
    const animation = element.animate(
      [
        { [VISIBILITY_PROPERTY]: currentVisibility },
        { [VISIBILITY_PROPERTY]: targetVisibility }
      ],
      {
        duration: MOTION_DURATION_MS * Math.abs(targetVisibility - currentVisibility),
        easing: 'ease-out'
      }
    );
    visibilityAnimations.set(element, animation);
    animation.onfinish = () => {
      if (visibilityAnimations.get(element) === animation) visibilityAnimations.delete(element);
    };
    animation.oncancel = () => {
      if (visibilityAnimations.get(element) === animation) visibilityAnimations.delete(element);
    };
  }

  function showTemporarily(element: HTMLElement): void {
    const existingTimer = activeTimers.get(element);
    if (existingTimer) clearTimeout(existingTimer);

    setVisibilityFlag(element, ACTIVE_CLASS, true);
    activeTimers.set(element, setTimeout(() => {
      setVisibilityFlag(element, ACTIVE_CLASS, false);
      activeTimers.delete(element);
    }, ACTIVE_DURATION_MS));
  }

  function setNearbyScroller(next: HTMLElement | null): void {
    if (nearbyScroller === next) return;
    if (nearbyScroller) setVisibilityFlag(nearbyScroller, NEAR_CLASS, false);
    nearbyScroller = next;
    if (nearbyScroller) setVisibilityFlag(nearbyScroller, NEAR_CLASS, true);
  }

  function handleWheel(event: WheelEvent): void {
    const scroller = findWheelScroller(event);
    if (scroller) showTemporarily(scroller);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (coarsePointer.matches || event.pointerType === 'touch') {
      setNearbyScroller(null);
      return;
    }

    setNearbyScroller(findNearbyScroller(event));
  }

  function clearNearbyScroller(): void {
    setNearbyScroller(null);
  }

  document.addEventListener('wheel', handleWheel, { capture: true, passive: true });
  document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true });
  document.documentElement.addEventListener('pointerleave', clearNearbyScroller);
  window.addEventListener('blur', clearNearbyScroller);

  return () => {
    document.removeEventListener('wheel', handleWheel, true);
    document.removeEventListener('pointermove', handlePointerMove, true);
    document.documentElement.removeEventListener('pointerleave', clearNearbyScroller);
    window.removeEventListener('blur', clearNearbyScroller);
    clearNearbyScroller();

    for (const [element, timer] of activeTimers) {
      clearTimeout(timer);
      element.classList.remove(ACTIVE_CLASS);
    }
    activeTimers.clear();
    for (const animation of visibilityAnimations.values()) animation.cancel();
    visibilityAnimations.clear();
  };
}
