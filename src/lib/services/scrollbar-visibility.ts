const ACTIVE_CLASS = 'izci-scrollbar-active';
const NEAR_CLASS = 'izci-scrollbar-near';
const EDGE_DISTANCE_PX = 18;
const ACTIVE_DURATION_MS = 850;
const MOTION_DURATION_MS = 180;
const VISIBILITY_PROPERTY = '--izci-scrollbar-visibility';
const OVERLAY_ROOT_CLASS = 'izci-overlay-vertical-scrollbars';
const OVERLAY_CLASS = 'izci-vertical-scrollbar-overlay';
const OVERLAY_THUMB_CLASS = 'izci-vertical-scrollbar-overlay-thumb';
const OVERLAY_WIDTH_PX = 10;
const MIN_THUMB_SIZE_PX = 28;

type ScrollAxis = 'horizontal' | 'vertical';

interface ScrollbarVisibilityOptions {
  overlayVertical?: boolean;
}

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

export function initializeScrollbarVisibility(
  { overlayVertical = false }: ScrollbarVisibilityOptions = {}
): () => void {
  const activeTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const visibilityAnimations = new Map<HTMLElement, Animation>();
  const coarsePointer = matchMedia('(pointer: coarse)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = matchMedia('(forced-colors: active)');
  let nearbyScroller: HTMLElement | null = null;
  let overlayScroller: HTMLElement | null = null;
  let overlayFrame: number | null = null;
  let dragStartY = 0;
  let dragStartScrollTop = 0;

  const overlay = overlayVertical ? document.createElement('div') : null;
  const overlayThumb = overlayVertical ? document.createElement('div') : null;

  if (overlay && overlayThumb) {
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute('aria-hidden', 'true');
    overlayThumb.className = OVERLAY_THUMB_CLASS;
    overlay.append(overlayThumb);
    document.body.append(overlay);
  }

  function syncOverlayMode(): void {
    document.documentElement.classList.toggle(
      OVERLAY_ROOT_CLASS,
      overlayVertical && !forcedColors.matches
    );
    if (forcedColors.matches) overlay?.classList.remove('is-visible');
    else scheduleOverlayRender();
  }

  syncOverlayMode();

  function isVisible(element: HTMLElement): boolean {
    return element.classList.contains(ACTIVE_CLASS) || element.classList.contains(NEAR_CLASS);
  }

  function renderOverlay(): void {
    overlayFrame = null;
    if (!overlay || !overlayThumb || forcedColors.matches || !overlayScroller?.isConnected) {
      overlay?.classList.remove('is-visible');
      return;
    }

    if (!isScrollable(overlayScroller, 'vertical')) {
      overlay.classList.remove('is-visible');
      return;
    }

    const rect = overlayScroller.getBoundingClientRect();
    const trackHeight = overlayScroller.clientHeight;
    const scrollRange = overlayScroller.scrollHeight - trackHeight;
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(MIN_THUMB_SIZE_PX, trackHeight * trackHeight / overlayScroller.scrollHeight)
    );
    const thumbOffset = scrollRange > 0
      ? overlayScroller.scrollTop / scrollRange * (trackHeight - thumbHeight)
      : 0;
    const clientLeft = rect.left + overlayScroller.clientLeft;

    overlay.style.left = `${clientLeft + overlayScroller.clientWidth - OVERLAY_WIDTH_PX}px`;
    overlay.style.top = `${rect.top + overlayScroller.clientTop}px`;
    overlay.style.height = `${trackHeight}px`;
    overlayThumb.style.top = `${thumbOffset}px`;
    overlayThumb.style.height = `${thumbHeight}px`;
    overlay.classList.toggle('is-visible', isVisible(overlayScroller));
  }

  function scheduleOverlayRender(): void {
    if (!overlay || overlayFrame !== null) return;
    overlayFrame = requestAnimationFrame(renderOverlay);
  }

  function setOverlayScroller(element: HTMLElement | null): void {
    if (!overlay || overlayScroller === element) {
      scheduleOverlayRender();
      return;
    }
    overlayScroller = element;
    scheduleOverlayRender();
  }

  function setVisibilityFlag(element: HTMLElement, className: string, enabled: boolean): void {
    const wasVisible = isVisible(element);
    const currentVisibility = Number.parseFloat(getComputedStyle(element).getPropertyValue(VISIBILITY_PROPERTY)) || 0;
    element.classList.toggle(className, enabled);
    const visible = isVisible(element);
    if (wasVisible === visible) return;

    if (element === overlayScroller) scheduleOverlayRender();

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
    if (isScrollable(element, 'vertical')) setOverlayScroller(element);
    activeTimers.set(element, setTimeout(() => {
      setVisibilityFlag(element, ACTIVE_CLASS, false);
      activeTimers.delete(element);
    }, ACTIVE_DURATION_MS));
  }

  function setNearbyScroller(next: HTMLElement | null): void {
    if (nearbyScroller === next) return;
    if (nearbyScroller) setVisibilityFlag(nearbyScroller, NEAR_CLASS, false);
    nearbyScroller = next;
    if (nearbyScroller) {
      setVisibilityFlag(nearbyScroller, NEAR_CLASS, true);
      if (isScrollable(nearbyScroller, 'vertical')) setOverlayScroller(nearbyScroller);
    }
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

    if (overlay && event.target instanceof Node && overlay.contains(event.target)) {
      setNearbyScroller(overlayScroller);
      return;
    }

    setNearbyScroller(findNearbyScroller(event));
  }

  function handleScroll(event: Event): void {
    if (!(event.target instanceof HTMLElement) || !isScrollable(event.target, 'vertical')) return;
    showTemporarily(event.target);
    scheduleOverlayRender();
  }

  function handleOverlayPointerDown(event: PointerEvent): void {
    if (!overlayThumb || !overlayScroller || event.button !== 0) return;
    dragStartY = event.clientY;
    dragStartScrollTop = overlayScroller.scrollTop;
    overlayThumb.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleOverlayPointerMove(event: PointerEvent): void {
    if (!overlayThumb?.hasPointerCapture(event.pointerId) || !overlayScroller) return;
    const trackHeight = overlayScroller.clientHeight;
    const thumbHeight = overlayThumb.getBoundingClientRect().height;
    const thumbRange = trackHeight - thumbHeight;
    const scrollRange = overlayScroller.scrollHeight - trackHeight;
    if (thumbRange <= 0 || scrollRange <= 0) return;
    overlayScroller.scrollTop = dragStartScrollTop
      + (event.clientY - dragStartY) / thumbRange * scrollRange;
  }

  function clearNearbyScroller(): void {
    setNearbyScroller(null);
  }

  document.addEventListener('wheel', handleWheel, { capture: true, passive: true });
  document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true });
  document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
  document.documentElement.addEventListener('pointerleave', clearNearbyScroller);
  window.addEventListener('blur', clearNearbyScroller);
  window.addEventListener('resize', scheduleOverlayRender, { passive: true });
  forcedColors.addEventListener('change', syncOverlayMode);
  overlayThumb?.addEventListener('pointerdown', handleOverlayPointerDown);
  overlayThumb?.addEventListener('pointermove', handleOverlayPointerMove);

  return () => {
    document.removeEventListener('wheel', handleWheel, true);
    document.removeEventListener('pointermove', handlePointerMove, true);
    document.removeEventListener('scroll', handleScroll, true);
    document.documentElement.removeEventListener('pointerleave', clearNearbyScroller);
    window.removeEventListener('blur', clearNearbyScroller);
    window.removeEventListener('resize', scheduleOverlayRender);
    forcedColors.removeEventListener('change', syncOverlayMode);
    overlayThumb?.removeEventListener('pointerdown', handleOverlayPointerDown);
    overlayThumb?.removeEventListener('pointermove', handleOverlayPointerMove);
    clearNearbyScroller();
    document.documentElement.classList.remove(OVERLAY_ROOT_CLASS);
    overlay?.remove();
    if (overlayFrame !== null) cancelAnimationFrame(overlayFrame);

    for (const [element, timer] of activeTimers) {
      clearTimeout(timer);
      element.classList.remove(ACTIVE_CLASS);
    }
    activeTimers.clear();
    for (const animation of visibilityAnimations.values()) animation.cancel();
    visibilityAnimations.clear();
  };
}
