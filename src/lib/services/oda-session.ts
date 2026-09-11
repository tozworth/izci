import type { OptionsViewName } from '../../options/views';

/** Initial groupings available inside the Oda music browser. */
export type OdaBrowseView =
  | 'tracks'
  | 'artists'
  | 'albums'
  | 'songs'
  | 'genres'
  | 'years'
  | 'formats'
  | 'folders';

export type OdaMedium = 'music' | 'video' | 'image';

export type OdaRoute =
  | { name: 'home' }
  | { name: 'browse'; medium: OdaMedium; view: OdaBrowseView; groupKey?: string }
  | { name: 'recents' }
  | { name: 'queue' }
  | { name: 'now-playing' }
  | { name: 'video-theater' }
  | { name: 'image-theater' }
  | { name: 'options'; view: OptionsViewName };

export interface OdaRouteEntry {
  route: OdaRoute;
  /** Focus ID to restore when this entry is popped by Back. */
  restoreFocusId: string | null;
}

export interface OdaSessionSnapshot {
  active: boolean;
  ownsFullscreen: boolean;
  route: OdaRoute;
  /** Currently focused logical focus ID, if any. */
  focusId: string | null;
  /** Increments whenever focus should be re-applied by the active view. */
  focusRequestToken: number;
  /** Focus ID to restore after the current route was pushed by Back. */
  restoreFocusId: string | null;
}

export interface OdaFullscreenAdapter {
  isFullscreen(): boolean;
  enter(): Promise<boolean>;
  exit(): Promise<boolean>;
}

interface CreateOdaSessionOptions {
  fullscreen: OdaFullscreenAdapter;
  onChange?(snapshot: OdaSessionSnapshot): void;
}

export const ODA_HOME_ROUTE: OdaRoute = { name: 'home' };

function sameRoute(first: OdaRoute, second: OdaRoute): boolean {
  if (first.name !== second.name) return false;
  if (first.name === 'browse' && second.name === 'browse') {
    return first.medium === second.medium
      && first.view === second.view
      && (first.groupKey ?? null) === (second.groupKey ?? null);
  }
  if (first.name === 'options' && second.name === 'options') {
    return first.view === second.view;
  }
  return true;
}

/**
 * Session-only Oda mode. Owns whether Oda is active, whether Oda initiated
 * the current DOM fullscreen session, and the route/focus stack. The active
 * bit is deliberately in memory and is never restored across reloads.
 */
export function createOdaSession({ fullscreen, onChange }: CreateOdaSessionOptions) {
  let active = false;
  let ownsFullscreen = false;
  let history: OdaRouteEntry[] = [{ route: ODA_HOME_ROUTE, restoreFocusId: null }];
  let focusId: string | null = null;
  let focusRequestToken = 0;
  let restoreFocusId: string | null = null;

  function snapshot(): OdaSessionSnapshot {
    return {
      active,
      ownsFullscreen,
      route: history[history.length - 1].route,
      focusId,
      focusRequestToken,
      restoreFocusId
    };
  }

  function notify(): void {
    onChange?.(snapshot());
  }

  function isActive(): boolean {
    return active;
  }

  async function enter(options: { fullscreen: boolean }): Promise<void> {
    if (active) return;
    active = true;
    ownsFullscreen = false;
    history = [{ route: ODA_HOME_ROUTE, restoreFocusId: null }];
    focusId = null;
    restoreFocusId = null;
    focusRequestToken += 1;
    notify();

    if (!options.fullscreen || fullscreen.isFullscreen()) {
      // Already fullscreen before Oda: record nothing so exiting Oda leaves it.
      return;
    }

    try {
      ownsFullscreen = await fullscreen.enter();
    } catch {
      ownsFullscreen = false;
    }
    notify();
  }

  async function exit(): Promise<void> {
    if (!active) return;
    active = false;
    const owned = ownsFullscreen;
    ownsFullscreen = false;
    history = [{ route: ODA_HOME_ROUTE, restoreFocusId: null }];
    focusId = null;
    restoreFocusId = null;
    focusRequestToken += 1;
    notify();

    if (!owned) return;
    try {
      await fullscreen.exit();
    } catch {
      // A failed exit leaves the browser in control of its fullscreen state.
    }
  }

  function push(route: OdaRoute): void {
    if (!active) return;
    const current = history[history.length - 1];
    if (sameRoute(current.route, route)) return;
    history.push({ route, restoreFocusId: focusId });
    focusId = null;
    restoreFocusId = null;
    focusRequestToken += 1;
    notify();
  }

  /** Reset the whole stack back to the home screen. */
  function goHome(): void {
    if (!active) return;
    if (history.length === 1 && sameRoute(history[0].route, ODA_HOME_ROUTE)) return;
    history = [{ route: ODA_HOME_ROUTE, restoreFocusId: null }];
    focusId = null;
    restoreFocusId = null;
    focusRequestToken += 1;
    notify();
  }

  /** Change the active Options category without pushing a new history entry. */
  function setOptionsView(view: OptionsViewName): void {
    if (!active) return;
    const top = history[history.length - 1];
    if (top.route.name !== 'options' || top.route.view === view) return;
    history[history.length - 1] = { ...top, route: { name: 'options', view } };
    notify();
  }

  function canGoBack(): boolean {
    return active && history.length > 1;
  }

  function back(): boolean {
    if (!canGoBack()) return false;
    const popped = history.pop()!;
    focusId = popped.restoreFocusId;
    restoreFocusId = popped.restoreFocusId;
    focusRequestToken += 1;
    notify();
    return true;
  }

  function setFocus(nextFocusId: string | null): void {
    if (!active || focusId === nextFocusId) return;
    focusId = nextFocusId;
    notify();
  }

  function clearRestoreFocus(): void {
    if (restoreFocusId === null) return;
    restoreFocusId = null;
    notify();
  }

  /**
   * Called from `fullscreenchange`. A browser-initiated exit leaves Oda active
   * in-window but drops fullscreen ownership so exiting Oda does not call into
   * the fullscreen API.
   */
  function handleFullscreenChange(): void {
    if (!ownsFullscreen) return;
    if (fullscreen.isFullscreen()) return;
    ownsFullscreen = false;
    notify();
  }

  return {
    getSnapshot: snapshot,
    isActive,
    handleFullscreenChange,
    enter,
    exit,
    push,
    goHome,
    setOptionsView,
    back,
    canGoBack,
    setFocus,
    clearRestoreFocus
  };
}

export type OdaSession = ReturnType<typeof createOdaSession>;
