import type { OptionsViewName } from '../../options/views';

/** Initial groupings available inside the Oda music browser. */
export type OdaBrowseView =
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
  | { name: 'image-viewer' }
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
  /**
   * A fullscreen request refused for lack of user activation is waiting for
   * the first input (deep-link entries, which have no activation of their own).
   */
  pendingFullscreenGesture: boolean;
}

export interface OdaFullscreenAdapter {
  isFullscreen(): boolean | Promise<boolean>;
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
 * the current fullscreen session, and the route/focus stack. The active
 * bit is deliberately in memory and is never restored across reloads.
 */
export function createOdaSession({ fullscreen, onChange }: CreateOdaSessionOptions) {
  let active = false;
  let ownsFullscreen = false;
  /**
   * Whether fullscreen was already active when Oda was entered. Exiting
   * Oda restores the pre-entry state: a pre-existing session is left alone,
   * anything else is exited so the desktop shell returns windowed.
   */
  let fullscreenAtEntry: boolean | Promise<boolean> = false;
  let pendingFullscreenGesture = false;
  /** Invalidated by exit so a still-pending enter cannot claim a dead session. */
  let entryGeneration = 0;
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
      restoreFocusId,
      pendingFullscreenGesture
    };
  }

  function notify(): void {
    onChange?.(snapshot());
  }

  function isActive(): boolean {
    return active;
  }

  async function enter(options: { fullscreen: boolean; retryFullscreenOnGesture?: boolean }): Promise<void> {
    if (active) return;
    const generation = ++entryGeneration;
    active = true;
    ownsFullscreen = false;
    try {
      const state = fullscreen.isFullscreen();
      fullscreenAtEntry = typeof state === 'boolean' ? state : state.catch(() => false);
    } catch {
      fullscreenAtEntry = false;
    }
    pendingFullscreenGesture = false;
    history = [{ route: ODA_HOME_ROUTE, restoreFocusId: null }];
    focusId = null;
    restoreFocusId = null;
    focusRequestToken += 1;
    notify();

    // Keep browser entry synchronous through requestFullscreen so WebKit's
    // user gesture survives; native window state is read asynchronously.
    const preexisting = typeof fullscreenAtEntry === 'boolean' ? fullscreenAtEntry : await fullscreenAtEntry;
    if (!active || generation !== entryGeneration) return;

    if (!options.fullscreen || preexisting) {
      // Already fullscreen before Oda: record nothing so exiting Oda leaves it.
      return;
    }

    let acquired = false;
    try {
      acquired = await fullscreen.enter();
    } catch {
      acquired = false;
    }
    if (!active || generation !== entryGeneration) {
      // Exit landed while the request was in flight. Never claim ownership
      // for an inactive session; release the grant instead of stranding the
      // desktop shell in fullscreen.
      if (acquired) {
        try {
          await fullscreen.exit();
        } catch {
          // A failed exit leaves the browser in control of its fullscreen state.
        }
      }
      return;
    }
    ownsFullscreen = acquired;
    pendingFullscreenGesture = Boolean(options.retryFullscreenOnGesture) && !ownsFullscreen;
    notify();
  }

  /**
   * Completes a fullscreen request that was refused at entry: a URL launch has
   * no user activation of its own, so the first real input spent here. One
   * attempt only — an activation-backed refusal will not succeed on a retry.
   */
  async function completeFullscreenOnGesture(): Promise<boolean> {
    if (!active || !pendingFullscreenGesture) return false;
    pendingFullscreenGesture = false;
    if (ownsFullscreen) return false;

    const generation = ++entryGeneration;
    let acquired = false;
    try {
      const state = fullscreen.isFullscreen();
      const preexisting = typeof state === 'boolean' ? state : await state;
      if (!active || generation !== entryGeneration || preexisting) return false;
      acquired = await fullscreen.enter();
    } catch {
      acquired = false;
    }
    if (!active || generation !== entryGeneration) {
      if (acquired) {
        try {
          await fullscreen.exit();
        } catch {
          // A failed exit leaves the browser in control of its fullscreen state.
        }
      }
      return false;
    }
    ownsFullscreen = acquired;
    notify();
    return ownsFullscreen;
  }

  async function exit(): Promise<void> {
    if (!active) return;
    entryGeneration += 1;
    active = false;
    const preexisting = fullscreenAtEntry;
    const owned = ownsFullscreen;
    ownsFullscreen = false;
    fullscreenAtEntry = false;
    pendingFullscreenGesture = false;
    history = [{ route: ODA_HOME_ROUTE, restoreFocusId: null }];
    focusId = null;
    restoreFocusId = null;
    focusRequestToken += 1;
    notify();

    // Ownership alone is not reliable: a browser shortcut or a competing
    // controller can drop it mid-session while fullscreen stays active.
    // Restore the pre-entry windowed state whenever fullscreen is live.
    try {
      if (typeof preexisting === 'boolean' ? preexisting : await preexisting) return;
      if (!owned && !await fullscreen.isFullscreen()) return;
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

  /** Switch the filter in the current browser without growing route history. */
  function setBrowseView(medium: OdaMedium, view: OdaBrowseView): void {
    if (!active) return;
    const top = history[history.length - 1];
    if (top.route.name !== 'browse') return;
    if (top.route.medium === medium && top.route.view === view && !top.route.groupKey) return;
    history[history.length - 1] = {
      ...top,
      route: { name: 'browse', medium, view }
    };
    focusId = null;
    restoreFocusId = null;
    focusRequestToken += 1;
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
  async function handleFullscreenChange(): Promise<void> {
    if (!ownsFullscreen) return;
    const generation = entryGeneration;
    try {
      const state = fullscreen.isFullscreen();
      const live = typeof state === 'boolean' ? state : await state;
      if (live || generation !== entryGeneration) return;
    } catch {
      return;
    }
    ownsFullscreen = false;
    notify();
  }

  return {
    getSnapshot: snapshot,
    isActive,
    handleFullscreenChange,
    enter,
    completeFullscreenOnGesture,
    exit,
    push,
    goHome,
    setBrowseView,
    setOptionsView,
    back,
    canGoBack,
    setFocus,
    clearRestoreFocus
  };
}

export type OdaSession = ReturnType<typeof createOdaSession>;
