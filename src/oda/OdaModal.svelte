<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { isOdaEditableTarget, normalizeOdaAction } from './oda-input';

  export let title: string;
  export let subtitle: string;
  export let dismissLabel = 'Close';
  export let onDismiss: () => void;
  export let wide = false;

  let dialog: HTMLDialogElement;

  function focusables(): HTMLElement[] {
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    ));
  }

  function moveFocus(direction: -1 | 1): void {
    const items = focusables();
    if (items.length === 0) return;
    const current = document.activeElement instanceof HTMLElement
      ? items.indexOf(document.activeElement)
      : -1;
    const next = current < 0
      ? (direction > 0 ? 0 : items.length - 1)
      : (current + direction + items.length) % items.length;
    items[next]?.focus();
  }

  function handleKeydown(event: KeyboardEvent): void {
    const action = normalizeOdaAction(event);
    if (!action) return;

    // Form fields retain their native editing behavior. Back still closes the
    // modal when focus is on a non-editable control.
    if (isOdaEditableTarget(event.target)) return;
    event.stopPropagation();

    if (action === 'back') {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (action === 'left' || action === 'up') {
      event.preventDefault();
      moveFocus(-1);
      return;
    }
    if (action === 'right' || action === 'down') {
      event.preventDefault();
      moveFocus(1);
    }
  }

  function handleKeyup(event: KeyboardEvent): void {
    if (normalizeOdaAction(event)) event.stopPropagation();
  }

  function handleCancel(event: Event): void {
    event.preventDefault();
    onDismiss();
  }

  onMount(() => {
    void tick().then(() => {
      if (!dialog.open) dialog.showModal();
      const preferred = dialog.querySelector<HTMLElement>('[data-oda-default]');
      (preferred ?? focusables()[0] ?? dialog).focus();
    });
  });

  onDestroy(() => {
    if (dialog?.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class:wide
  aria-modal="true"
  aria-labelledby="oda-modal-title"
  aria-describedby="oda-modal-subtitle"
  tabindex="-1"
  on:cancel={handleCancel}
  on:keydown={handleKeydown}
  on:keyup={handleKeyup}
>
  <header>
    <div class="oda-modal-mark"><slot name="mark" /></div>
    <div class="oda-modal-heading">
      <h2 id="oda-modal-title">{title}</h2>
      <p id="oda-modal-subtitle">{subtitle}</p>
    </div>
  </header>

  <div class="oda-modal-content"><slot /></div>

  <footer>
    <slot name="actions">
      <button type="button" data-oda-default on:click={onDismiss}>{dismissLabel}</button>
    </slot>
  </footer>
</dialog>

<style>
  dialog {
    box-sizing: border-box;
    width: min(34rem, calc(100vw - 3rem));
    max-width: none;
    max-height: min(46rem, calc(100vh - 3rem));
    margin: 0;
    padding: 1.3rem 1.45rem 1.25rem;
    position: fixed;
    inset: auto auto max(env(safe-area-inset-bottom, 0px), 1.25rem)
      max(env(safe-area-inset-left, 0px), 1.25rem);
    overflow: auto;
    border: 1px solid var(--oda-border-strong, var(--border-strong));
    border-radius: 0.8rem;
    background: color-mix(in srgb, var(--oda-bg-elevated, var(--bg-elevated)) 96%, transparent);
    color: var(--oda-text, var(--text));
    box-shadow:
      0 -2.5rem 6rem rgba(0, 0, 0, 0.48),
      0 1rem 2.5rem rgba(0, 0, 0, 0.52);
    outline: none;
  }

  dialog.wide {
    width: min(44rem, calc(100vw - 3rem));
  }

  dialog::backdrop {
    background: rgba(3, 5, 8, 0.58);
  }

  header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 1.3rem;
  }

  .oda-modal-mark {
    display: grid;
    min-width: 7.2rem;
    min-height: 5.2rem;
    place-items: center;
    border-right: 1px solid var(--oda-border, var(--border));
  }

  .oda-modal-heading {
    min-width: 0;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    color: var(--oda-text, var(--text-strong));
    font-size: clamp(1.45rem, 2.7vw, 2rem);
    font-weight: 750;
    line-height: 1.05;
  }

  header p {
    margin-top: 0.45rem;
    color: var(--oda-muted, var(--muted));
    font-size: clamp(0.86rem, 1.5vw, 1.05rem);
    line-height: 1.35;
  }

  .oda-modal-content {
    margin-top: 1.2rem;
    font-size: 0.92rem;
    line-height: 1.5;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.7rem;
    margin-top: 1.2rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--oda-border, var(--border));
  }

  :global(.oda-shell) dialog button,
  footer :global(button) {
    min-width: 7rem;
    min-height: 2.65rem;
    padding: 0.55rem 1rem;
    border: 1px solid var(--oda-border-strong, var(--border-strong));
    border-radius: 0.45rem;
    background: var(--oda-surface, var(--bg-soft));
    color: var(--oda-text, var(--text));
    font: inherit;
    font-weight: 650;
  }

  footer :global(button:hover),
  footer :global(button:focus-visible) {
    border-color: var(--oda-focus, var(--accent-strong));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--oda-focus, var(--accent-strong)) 45%, transparent);
    outline: none;
  }

  footer :global(button.primary) {
    border-color: var(--oda-accent-strong, var(--accent-strong));
    background: color-mix(in srgb, var(--oda-accent, var(--accent)) 20%, var(--oda-surface, var(--bg-soft)));
  }

  footer :global(button:disabled) {
    opacity: 0.48;
  }

  @media (max-width: 560px) {
    dialog,
    dialog.wide {
      width: calc(100vw - 1.5rem);
      max-height: calc(100vh - 1.5rem);
      inset: auto auto max(env(safe-area-inset-bottom, 0px), 0.75rem)
        max(env(safe-area-inset-left, 0px), 0.75rem);
      padding: 1rem;
    }

    header {
      gap: 0.85rem;
    }

    .oda-modal-mark {
      min-width: 5.7rem;
    }
  }
</style>
