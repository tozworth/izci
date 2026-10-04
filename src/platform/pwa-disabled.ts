// Packaged shells ship their assets directly and never register a service worker.
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => undefined;
}
