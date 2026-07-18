<script lang="ts">
  export let placement: 'above' | 'below' = 'below';
  export let align: 'left' | 'center' | 'right' = 'right';
  export let nowrap = false;
</script>

<span
  class="hover-tooltip"
  class:is-above={placement === 'above'}
  class:is-left-aligned={align === 'left'}
  class:is-center-aligned={align === 'center'}
  class:is-nowrap={nowrap}
  role="tooltip"
>
  <slot />
</span>

<style>
  .hover-tooltip {
    position: absolute;
    z-index: 80;
    top: calc(100% + 4px);
    right: 0;
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

  .hover-tooltip.is-left-aligned {
    right: auto;
    left: 0;
    transform-origin: top left;
  }

  .hover-tooltip.is-center-aligned {
    right: auto;
    left: 50%;
    transform: translate(-50%, -2px) scale(0.98);
    transform-origin: top center;
  }

  .hover-tooltip.is-nowrap {
    white-space: nowrap;
  }

  :global(.hover-tooltip-anchor:hover) .hover-tooltip,
  :global(.hover-tooltip-anchor:focus-visible) .hover-tooltip {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  :global(.hover-tooltip-anchor:hover) .hover-tooltip.is-center-aligned,
  :global(.hover-tooltip-anchor:focus-visible) .hover-tooltip.is-center-aligned {
    transform: translate(-50%, 0) scale(1);
  }

  .hover-tooltip.is-above {
    top: auto;
    bottom: calc(100% + 4px);
    transform: translateY(2px) scale(0.98);
    transform-origin: bottom right;
  }

  .hover-tooltip.is-above.is-left-aligned {
    transform-origin: bottom left;
  }

  .hover-tooltip.is-above.is-center-aligned {
    transform: translate(-50%, 2px) scale(0.98);
    transform-origin: bottom center;
  }

  :global(.hover-tooltip-anchor:hover) .hover-tooltip.is-above,
  :global(.hover-tooltip-anchor:focus-visible) .hover-tooltip.is-above {
    transform: translateY(0) scale(1);
  }

  :global(.hover-tooltip-anchor:hover) .hover-tooltip.is-above.is-center-aligned,
  :global(.hover-tooltip-anchor:focus-visible) .hover-tooltip.is-above.is-center-aligned {
    transform: translate(-50%, 0) scale(1);
  }
</style>
