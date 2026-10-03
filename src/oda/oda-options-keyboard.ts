import { normalizeOdaAction } from './oda-input';

/** Runs in capture phase so moving between fields cannot also open a select. */
export function handleOdaOptionsKeydown(
  event: KeyboardEvent,
  moveControlFocus: (target: EventTarget | null, delta: -1 | 1) => void
): void {
  const target = event.target;
  const action = normalizeOdaAction(event);
  const isCombobox = target instanceof HTMLButtonElement && target.getAttribute('role') === 'combobox';
  const selectOpen = isCombobox && target.getAttribute('aria-expanded') === 'true';

  if (isCombobox && (action === 'ok' || (selectOpen && action === 'back'))) {
    // Translate remote aliases for the shared control. It owns activation and
    // dismissal; a held OK must not immediately select and reopen the menu.
    if (event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const key = action === 'ok' ? 'Enter' : 'Escape';
    if (event.key !== key) {
      event.preventDefault();
      event.stopPropagation();
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    return;
  }

  if (selectOpen && (action === 'up' || action === 'down')) return;

  if (action === 'up' || action === 'down') {
    event.preventDefault();
    event.stopPropagation();
    moveControlFocus(target, action === 'up' ? -1 : 1);
    return;
  }
  if ((action === 'left' || action === 'right') && target instanceof HTMLInputElement && target.type === 'checkbox') {
    event.preventDefault();
    event.stopPropagation();
    const checked = action === 'right';
    if (target.checked !== checked) {
      target.checked = checked;
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }
  if ((action === 'left' || action === 'right') && target instanceof HTMLSelectElement) {
    event.preventDefault();
    event.stopPropagation();
    const delta = action === 'left' ? -1 : 1;
    const nextIndex = Math.min(Math.max(target.selectedIndex + delta, 0), target.options.length - 1);
    if (nextIndex !== target.selectedIndex) {
      target.selectedIndex = nextIndex;
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }
  if ((action === 'left' || action === 'right') && target instanceof HTMLButtonElement) {
    event.preventDefault();
    event.stopPropagation();
    if (!selectOpen) moveControlFocus(target, action === 'left' ? -1 : 1);
  }
}
