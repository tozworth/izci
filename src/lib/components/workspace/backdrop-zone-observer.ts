export interface BackdropZoneObserver {
  refresh(): void;
  destroy(): void;
}

export function observeBackdropZones(
  host: HTMLElement,
  selector: string,
  zoneAttribute: string,
  update: (shell: HTMLElement, zones: HTMLElement[]) => void
): BackdropZoneObserver | null {
  const shellElement = host.closest<HTMLElement>('.app-shell');
  if (!shellElement || typeof window === 'undefined') return null;
  const shell = shellElement;

  let animationFrame: number | null = null;
  let refreshFrame: number | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let observedZones = new Set<Element>();

  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(refresh);
  const mutationObserver = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(refresh);

  function runUpdate(): void {
    animationFrame = null;
    const zones = Array.from(shell.querySelectorAll<HTMLElement>(selector)).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    if (resizeObserver) {
      const nextZones = new Set<Element>(zones);
      for (const element of observedZones) {
        if (!nextZones.has(element)) resizeObserver.unobserve(element);
      }
      for (const element of nextZones) {
        if (!observedZones.has(element)) resizeObserver.observe(element);
      }
      observedZones = nextZones;
    }

    update(shell, zones);
  }

  function scheduleUpdate(): void {
    if (animationFrame !== null) return;
    animationFrame = window.requestAnimationFrame(runUpdate);
  }

  function refresh(): void {
    scheduleUpdate();

    if (refreshFrame === null) {
      refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = window.requestAnimationFrame(() => {
          refreshFrame = null;
          scheduleUpdate();
        });
      });
    }

    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      scheduleUpdate();
    }, 120);
  }

  function destroy(): void {
    window.removeEventListener('resize', refresh);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    if (refreshFrame !== null) window.cancelAnimationFrame(refreshFrame);
    if (refreshTimer !== null) clearTimeout(refreshTimer);
  }

  resizeObserver?.observe(shell);
  mutationObserver?.observe(shell, {
    attributes: true,
    attributeFilter: ['class', zoneAttribute, 'data-backdrop-zone-id', 'hidden', 'style'],
    childList: true,
    subtree: true
  });
  window.addEventListener('resize', refresh);
  refresh();

  return { refresh, destroy };
}
