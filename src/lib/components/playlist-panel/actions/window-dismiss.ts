type WindowDismissOptions = {
  enabled?: boolean;
  onDismiss: () => void;
};

export const WINDOW_DISMISS_IGNORE_SCROLL_ATTRIBUTE = 'data-window-dismiss-ignore-scroll';

export function windowDismiss(node: HTMLElement, initialOptions: WindowDismissOptions) {
  if (typeof window === 'undefined') {
    return {
      update() {},
      destroy() {}
    };
  }

  let options = initialOptions;

  const dismiss = () => {
    if (options.enabled === false) {
      return;
    }

    options.onDismiss();
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (options.enabled === false) {
      return;
    }

    const target = event.target;

    if (target instanceof Node && node.contains(target)) {
      return;
    }

    dismiss();
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      dismiss();
    }
  };

  const handleScroll = (event: Event) => {
    const target = event.target;

    if (target instanceof Element && target.closest(`[${WINDOW_DISMISS_IGNORE_SCROLL_ATTRIBUTE}]`)) {
      return;
    }

    dismiss();
  };

  window.addEventListener('pointerdown', handlePointerDown, true);
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('scroll', handleScroll, true);
  window.addEventListener('blur', dismiss);
  window.addEventListener('resize', dismiss);

  return {
    update(nextOptions: WindowDismissOptions) {
      options = nextOptions;
    },
    destroy() {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
    }
  };
}
