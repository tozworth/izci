/**
 * Oda deep links: `/oda` or `#oda` open the app straight into Oda, so a TV
 * browser bookmark or launcher shortcut never has to reach the menu bar.
 *
 * The marker is consumed on read, so a reload does not re-enter Oda and the
 * session-only rule holds. The path form needs the host to serve the app shell
 * for `/oda` (the Firebase rewrite and the service-worker navigation fallback
 * do); the hash form works everywhere.
 */

const ODA_DEEPLINK_KEY = 'oda';

function markerSegments(value: string): string[] {
  return value.split('/').filter((segment) => segment.length > 0);
}

function isOdaMarker(segments: string[]): boolean {
  return segments.length === 1 && segments[0].trim().toLowerCase() === ODA_DEEPLINK_KEY;
}

/** True for `#oda` (and `#oda/`). */
export function isOdaDeeplinkHash(hash: string): boolean {
  return hash.startsWith('#') && isOdaMarker(markerSegments(hash.slice(1)));
}

/** True for `/oda` (and `/oda/`); false for every other path, tool pages included. */
export function isOdaDeeplinkPath(pathname: string): boolean {
  return isOdaMarker(markerSegments(pathname));
}

function stripMarker(history: Pick<History, 'replaceState'>, url: string): void {
  try {
    history.replaceState(null, '', url);
  } catch {
    // The marker is cosmetic; a stale URL only risks re-entering Oda.
  }
}

/**
 * Reads the marker from the current URL and strips it, leaving other paths,
 * parameters and fragments intact. Returns whether Oda was requested.
 */
export function consumeOdaDeeplink(
  location: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  history: Pick<History, 'replaceState'> = window.history
): boolean {
  const path = location.pathname || '/';

  if (isOdaDeeplinkHash(location.hash)) {
    stripMarker(history, `${path}${location.search}`);
    return true;
  }

  if (isOdaDeeplinkPath(path)) {
    // Back to the app root so the path form is not sticky either.
    stripMarker(history, `/${location.search}${location.hash}`);
    return true;
  }

  return false;
}

/**
 * Follows a hash link followed while the app is already open. Returns an
 * unsubscribe function.
 */
export function watchOdaDeeplink(onRequest: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleHashChange = () => {
    if (consumeOdaDeeplink()) onRequest();
  };

  window.addEventListener('hashchange', handleHashChange);
  return () => window.removeEventListener('hashchange', handleHashChange);
}
