export function portal(node: HTMLElement) {
  if (typeof document === 'undefined') {
    return {
      destroy() {}
    };
  }

  const host = document.body;
  host.appendChild(node);

  return {
    destroy() {
      if (node.parentNode === host) {
        host.removeChild(node);
      }
    }
  };
}
