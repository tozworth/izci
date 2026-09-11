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
