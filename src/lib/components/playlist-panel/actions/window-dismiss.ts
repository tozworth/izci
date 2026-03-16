type WindowDismissOptions = {
  enabled?: boolean;
  onDismiss: () => void;
};

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

  window.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('scroll', dismiss, true);
  window.addEventListener('blur', dismiss);
  window.addEventListener('resize', dismiss);

  return {
    update(nextOptions: WindowDismissOptions) {
      options = nextOptions;
    },
    destroy() {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
    }
  };
}
