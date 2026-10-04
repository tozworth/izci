<script lang="ts">
  export let placement: 'above' | 'below' = 'below';
  export let align: 'left' | 'center' | 'right' = 'right';
  export let nowrap = false;
  export let showWhen: (anchor: HTMLElement) => boolean = () => true;

  let tooltipElement: HTMLSpanElement;
  let anchorElement: HTMLElement | null = null;
  let visible = false;

  function positionTooltip(): void {
    if (!anchorElement || !tooltipElement || typeof window === 'undefined') return;

    const anchorRect = anchorElement.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    const viewportInset = 6;
    const gap = 4;
    const preferredLeft = align === 'left'
      ? anchorRect.left
      : align === 'center'
        ? anchorRect.left + (anchorRect.width - tooltipRect.width) / 2
        : anchorRect.right - tooltipRect.width;
    const maxLeft = Math.max(viewportInset, window.innerWidth - tooltipRect.width - viewportInset);
    const preferredTop = placement === 'above'
      ? anchorRect.top - tooltipRect.height - gap
      : anchorRect.bottom + gap;
    const maxTop = Math.max(viewportInset, window.innerHeight - tooltipRect.height - viewportInset);

    tooltipElement.style.left = `${Math.min(Math.max(preferredLeft, viewportInset), maxLeft)}px`;
    tooltipElement.style.top = `${Math.min(Math.max(preferredTop, viewportInset), maxTop)}px`;
  }

  function showTooltip(): void {
    if (!anchorElement || !showWhen(anchorElement)) return;
    visible = true;
    positionTooltip();
  }

  function handleFocus(): void {
    if (anchorElement?.matches(':focus-visible')) showTooltip();
  }

  function mountTooltip(node: HTMLSpanElement) {
    if (typeof document === 'undefined') return {};

    anchorElement = node.parentElement;
    document.body.appendChild(node);
    anchorElement?.addEventListener('pointerenter', showTooltip);
    anchorElement?.addEventListener('pointerleave', hideTooltip);
    anchorElement?.addEventListener('focus', handleFocus);
    anchorElement?.addEventListener('blur', hideTooltip);
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);

    return {
      destroy() {
        anchorElement?.removeEventListener('pointerenter', showTooltip);
        anchorElement?.removeEventListener('pointerleave', hideTooltip);
        anchorElement?.removeEventListener('focus', handleFocus);
        anchorElement?.removeEventListener('blur', hideTooltip);
        window.removeEventListener('resize', positionTooltip);
        window.removeEventListener('scroll', positionTooltip, true);
        anchorElement = null;
        if (node.parentNode === document.body) document.body.removeChild(node);
      }
    };
  }

  function hideTooltip(): void {
    visible = false;
  }
</script>

<span
  bind:this={tooltipElement}
  use:mountTooltip
  class="hover-tooltip"
  class:is-visible={visible}
  class:is-above={placement === 'above'}
  class:is-left-aligned={align === 'left'}
  class:is-center-aligned={align === 'center'}
  class:is-nowrap={nowrap}
  aria-hidden={!visible}
  role="tooltip"
>
  <slot />
</span>

<style>
  .hover-tooltip {
    position: fixed;
    z-index: 1000;
    top: 0;
    left: 0;
    width: max-content;
    max-width: min(240px, 70vw);
    padding: 4px 7px;
    border: 1px solid var(--menu-bar-border);
    border-radius: 5px;
    background: var(--menu-popover-bg);
    color: var(--menu-popover-text, var(--text-strong));
    box-shadow: var(--menu-popover-shadow, 0 5px 14px rgba(0, 0, 0, 0.38));
    font-size: 0.68rem;
    font-weight: 400;
    line-height: 1.25;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-2px) scale(0.98);
    transform-origin: top right;
    transition: opacity 55ms ease-out, transform 55ms ease-out;
    white-space: normal;
  }

  .hover-tooltip.is-visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .hover-tooltip.is-left-aligned {
    transform-origin: top left;
  }

  .hover-tooltip.is-center-aligned {
    transform-origin: top center;
  }

  .hover-tooltip.is-nowrap {
    white-space: nowrap;
  }

  .hover-tooltip.is-above {
    transform: translateY(2px) scale(0.98);
    transform-origin: bottom right;
  }

  .hover-tooltip.is-above.is-visible {
    transform: translateY(0) scale(1);
  }

  .hover-tooltip.is-above.is-left-aligned {
    transform-origin: bottom left;
  }

  .hover-tooltip.is-above.is-center-aligned {
    transform-origin: bottom center;
  }
</style>
