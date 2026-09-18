import { describe, expect, it, vi } from 'vitest';
import { ODA_HOME_ROUTE, createOdaSession, type OdaFullscreenAdapter } from './oda-session';

function createFullscreenAdapter(initial: boolean): OdaFullscreenAdapter & {
  fullscreen: boolean;
  enterCalls: number;
  exitCalls: number;
} {
  const adapter = {
    fullscreen: initial,
    enterCalls: 0,
    exitCalls: 0,
    isFullscreen: () => adapter.fullscreen,
    enter: vi.fn(async () => {
      adapter.enterCalls += 1;
      adapter.fullscreen = true;
      return true;
    }),
    exit: vi.fn(async () => {
      adapter.exitCalls += 1;
      adapter.fullscreen = false;
      return true;
    })
  };
  return adapter;
}

describe('createOdaSession', () => {
  it('starts inactive on the home route', () => {
    const session = createOdaSession({ fullscreen: createFullscreenAdapter(false) });
    expect(session.getSnapshot()).toMatchObject({
      active: false,
      route: ODA_HOME_ROUTE,
      ownsFullscreen: false
    });
  });

  it('enters, requests fullscreen, and owns it on success', async () => {
    const fullscreen = createFullscreenAdapter(false);
    const session = createOdaSession({ fullscreen });
    await session.enter({ fullscreen: true });

    expect(session.getSnapshot()).toMatchObject({ active: true, ownsFullscreen: true });
    expect(fullscreen.enterCalls).toBe(1);
  });

  it('stays active when fullscreen is rejected', async () => {
    const fullscreen: OdaFullscreenAdapter = {
      isFullscreen: () => false,
      enter: vi.fn(async () => false),
      exit: vi.fn(async () => true)
    };
    const session = createOdaSession({ fullscreen });
    await session.enter({ fullscreen: true });

    expect(fullscreen.enter).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({ active: true, ownsFullscreen: false });
  });

  it('stays active when requesting fullscreen throws', async () => {
    const fullscreen: OdaFullscreenAdapter = {
      isFullscreen: () => false,
      enter: vi.fn(async () => {
        throw new Error('denied');
      }),
      exit: vi.fn(async () => true)
    };
    const session = createOdaSession({ fullscreen });
    await session.enter({ fullscreen: true });

    expect(session.getSnapshot()).toMatchObject({ active: true, ownsFullscreen: false });
  });

  it('preserves a pre-existing fullscreen session on exit', async () => {
    const fullscreen = createFullscreenAdapter(true);
    const session = createOdaSession({ fullscreen });
    await session.enter({ fullscreen: true });

    expect(fullscreen.enterCalls).toBe(0);
    expect(session.getSnapshot().ownsFullscreen).toBe(false);

    await session.exit();
    expect(fullscreen.exitCalls).toBe(0);
    expect(fullscreen.fullscreen).toBe(true);
    expect(session.getSnapshot().active).toBe(false);
  });

  it('exits fullscreen on exit only when Oda owns it', async () => {
    const fullscreen = createFullscreenAdapter(false);
    const session = createOdaSession({ fullscreen });
    await session.enter({ fullscreen: true });
    await session.exit();

    expect(fullscreen.exitCalls).toBe(1);
    expect(fullscreen.fullscreen).toBe(false);
  });

  it('respects the fullscreen preference', async () => {
    const fullscreen = createFullscreenAdapter(false);
    const session = createOdaSession({ fullscreen });
    await session.enter({ fullscreen: false });

    expect(fullscreen.enterCalls).toBe(0);
    expect(session.getSnapshot().active).toBe(true);
  });

  it('drops fullscreen ownership after a browser-initiated exit but stays active', async () => {
    const fullscreen = createFullscreenAdapter(false);
    const session = createOdaSession({ fullscreen });
    await session.enter({ fullscreen: true });
    expect(session.getSnapshot().ownsFullscreen).toBe(true);

    fullscreen.fullscreen = false;
    session.handleFullscreenChange();

    expect(session.getSnapshot()).toMatchObject({ active: true, ownsFullscreen: false });

    await session.exit();
    expect(fullscreen.exitCalls).toBe(0);
  });

  it('arms a gesture retry when a fullscreen request is refused', async () => {
    const fullscreen: OdaFullscreenAdapter = {
      isFullscreen: () => false,
      enter: vi.fn(async () => false),
      exit: vi.fn(async () => true)
    };
    const session = createOdaSession({ fullscreen });
    await session.enter({ fullscreen: true, retryFullscreenOnGesture: true });

    expect(session.getSnapshot().pendingFullscreenGesture).toBe(true);

    expect(await session.completeFullscreenOnGesture()).toBe(false);
    expect(session.getSnapshot()).toMatchObject({
      ownsFullscreen: false,
      pendingFullscreenGesture: false
    });
    expect(fullscreen.enter).toHaveBeenCalledTimes(2);

    // One attempt only: a second input must not call into the fullscreen API.
    expect(await session.completeFullscreenOnGesture()).toBe(false);
    expect(fullscreen.enter).toHaveBeenCalledTimes(2);
  });

  it('claims fullscreen from the first input after a deep-link entry', async () => {
    const fullscreen = createFullscreenAdapter(false);
    const session = createOdaSession({
      fullscreen: {
        isFullscreen: () => fullscreen.fullscreen,
        enter: async () => {
          // The boot-time request has no user activation and is refused.
          fullscreen.enterCalls += 1;
          fullscreen.fullscreen = fullscreen.enterCalls > 1;
          return fullscreen.fullscreen;
        },
        exit: async () => true
      }
    });
    await session.enter({ fullscreen: true, retryFullscreenOnGesture: true });
    expect(session.getSnapshot()).toMatchObject({ ownsFullscreen: false, pendingFullscreenGesture: true });

    expect(await session.completeFullscreenOnGesture()).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ ownsFullscreen: true, pendingFullscreenGesture: false });
  });

  it('does not arm a gesture retry for a menu entry or a refused opt-out', async () => {
    const refused: OdaFullscreenAdapter = {
      isFullscreen: () => false,
      enter: vi.fn(async () => false),
      exit: vi.fn(async () => true)
    };
    const withoutRetry = createOdaSession({ fullscreen: refused });
    await withoutRetry.enter({ fullscreen: true });
    expect(withoutRetry.getSnapshot().pendingFullscreenGesture).toBe(false);

    const optedOut = createOdaSession({ fullscreen: refused });
    await optedOut.enter({ fullscreen: false, retryFullscreenOnGesture: true });
    expect(optedOut.getSnapshot().pendingFullscreenGesture).toBe(false);
    expect(await optedOut.completeFullscreenOnGesture()).toBe(false);
  });

  it('drops a pending fullscreen retry on exit', async () => {
    const fullscreen: OdaFullscreenAdapter = {
      isFullscreen: () => false,
      enter: vi.fn(async () => false),
      exit: vi.fn(async () => true)
    };
    const session = createOdaSession({ fullscreen });
    await session.enter({ fullscreen: true, retryFullscreenOnGesture: true });
    expect(session.getSnapshot().pendingFullscreenGesture).toBe(true);

    await session.exit();
    expect(session.getSnapshot().pendingFullscreenGesture).toBe(false);
    expect(await session.completeFullscreenOnGesture()).toBe(false);
    expect(fullscreen.enter).toHaveBeenCalledTimes(1);
  });

  it('pushes routes, restores originating focus on Back, and ignores Back at home', () => {
    const session = createOdaSession({ fullscreen: createFullscreenAdapter(false) });
    return session.enter({ fullscreen: false }).then(() => {
      expect(session.back()).toBe(false);

      session.setFocus('card-queue');
      session.push({ name: 'now-playing' });
      expect(session.getSnapshot().route).toEqual({ name: 'now-playing' });
      expect(session.getSnapshot().focusId).toBeNull();

      expect(session.back()).toBe(true);
      expect(session.getSnapshot().route).toEqual(ODA_HOME_ROUTE);
      expect(session.getSnapshot().focusId).toBe('card-queue');
      expect(session.getSnapshot().restoreFocusId).toBe('card-queue');
      expect(session.canGoBack()).toBe(false);
    });
  });

  it('goes home from a deep stack and consumes Back', async () => {
    const session = createOdaSession({ fullscreen: createFullscreenAdapter(false) });
    await session.enter({ fullscreen: false });
    session.push({ name: 'browse', medium: 'music', view: 'artists' });
    session.push({ name: 'options', view: 'appearance' });
    expect(session.canGoBack()).toBe(true);

    session.goHome();
    expect(session.getSnapshot().route).toEqual(ODA_HOME_ROUTE);
    expect(session.canGoBack()).toBe(false);
    expect(session.back()).toBe(false);
  });

  it('pushes browse groups as distinct routes and restores group focus on Back', async () => {
    const session = createOdaSession({ fullscreen: createFullscreenAdapter(false) });
    await session.enter({ fullscreen: false });

    session.setFocus('card-artists');
    session.push({ name: 'browse', medium: 'music', view: 'artists' });
    session.setFocus('group:artists:aphex');
    session.push({ name: 'browse', medium: 'music', view: 'artists', groupKey: 'artists:aphex' });

    expect(session.getSnapshot().route).toEqual({
      name: 'browse',
      medium: 'music',
      view: 'artists',
      groupKey: 'artists:aphex'
    });

    expect(session.back()).toBe(true);
    expect(session.getSnapshot().route).toEqual({ name: 'browse', medium: 'music', view: 'artists' });
    expect(session.getSnapshot().focusId).toBe('group:artists:aphex');
  });

  it('switches browser filters in place and clears group state', async () => {
    const session = createOdaSession({ fullscreen: createFullscreenAdapter(false) });
    await session.enter({ fullscreen: false });
    session.push({ name: 'browse', medium: 'music', view: 'albums', groupKey: 'album:one' });

    session.setBrowseView('music', 'artists');

    expect(session.getSnapshot().route).toEqual({
      name: 'browse',
      medium: 'music',
      view: 'artists'
    });
    expect(session.getSnapshot().focusId).toBeNull();
    expect(session.canGoBack()).toBe(true);
  });

  it('notifies subscribers on state transitions', async () => {
    const changes: string[] = [];
    const session = createOdaSession({
      fullscreen: createFullscreenAdapter(false),
      onChange: (snapshot) => changes.push(snapshot.active ? snapshot.route.name : 'inactive')
    });
    await session.enter({ fullscreen: false });
    session.push({ name: 'recents' });
    await session.exit();

    expect(changes).toEqual(['home', 'recents', 'inactive']);
  });
});
