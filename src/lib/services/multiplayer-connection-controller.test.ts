import { describe, expect, it, vi } from 'vitest';
import { createMultiplayerConnectionController } from './multiplayer-connection-controller';
import type { MultiplayerSessionController, MultiplayerSessionState } from './multiplayer-types';

type SubscribeHandler = (value: MultiplayerSessionState) => void;

function createSession(overrides: Partial<MultiplayerSessionController> = {}): MultiplayerSessionController {
  return {
    subscribe: vi.fn(() => () => undefined),
    getSnapshot: () => ({}) as MultiplayerSessionState,
    ...overrides
  } as MultiplayerSessionController;
}

function sessionState(
  partial: { mode?: string; connectionStatus?: string; message?: string | null } = {}
): MultiplayerSessionState {
  return {
    mode: 'idle',
    connectionStatus: 'idle',
    message: null,
    ...partial
  } as MultiplayerSessionState;
}

function captureSubscribe(session: MultiplayerSessionController): { handler: SubscribeHandler } {
  const capture: { handler: SubscribeHandler } = { handler: () => undefined };
  session.subscribe = vi.fn((handler: SubscribeHandler) => {
    capture.handler = handler;
    return () => undefined;
  });
  return capture;
}

describe('multiplayer connection controller', () => {
  it('host begins a hosting dialog and starts the session', async () => {
    const startHosting = vi.fn(async () => 'CODE');
    const session = createSession({ startHosting: startHosting as never });
    const controller = createMultiplayerConnectionController({ session, pausePlayback: vi.fn() });

    await controller.host();

    expect(controller.getSnapshot()).toMatchObject({
      dialogOpen: true,
      dialogError: null,
      operation: 'hosting'
    });
    expect(startHosting).toHaveBeenCalledOnce();
  });

  it('host surfaces the error into the dialog on failure', async () => {
    const startHosting = vi.fn(async () => {
      throw new Error('room full');
    });
    const session = createSession({ startHosting: startHosting as never });
    const controller = createMultiplayerConnectionController({ session, pausePlayback: vi.fn() });

    await controller.host();

    expect(controller.getSnapshot()).toMatchObject({
      dialogOpen: true,
      dialogError: 'room full',
      operation: 'hosting'
    });
  });

  it('join pauses local playback and joins with the invite code', async () => {
    const join = vi.fn(async () => undefined);
    const pausePlayback = vi.fn();
    const session = createSession({ join: join as never });
    const controller = createMultiplayerConnectionController({ session, pausePlayback });

    await controller.join('INVITE');

    expect(pausePlayback).toHaveBeenCalledOnce();
    expect(join).toHaveBeenCalledWith('INVITE');
    expect(controller.getSnapshot()).toMatchObject({
      dialogOpen: true,
      operation: 'joining'
    });
  });

  it('dismissDialog leaves a client session', () => {
    const leave = vi.fn(async () => undefined);
    const session = createSession({ leave: leave as never });
    session.getSnapshot = () => sessionState({ mode: 'client' });
    const controller = createMultiplayerConnectionController({ session, pausePlayback: vi.fn() });

    controller.begin('joining', 'Peer');
    controller.dismissDialog();

    expect(leave).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      dialogOpen: false,
      dialogError: null
    });
  });

  it('dismissDialog stops hosting when hosting but not yet connected', () => {
    const stopHosting = vi.fn(async () => undefined);
    const session = createSession({ stopHosting: stopHosting as never });
    session.getSnapshot = () => sessionState({ mode: 'hosting', connectionStatus: 'connecting' });
    const controller = createMultiplayerConnectionController({ session, pausePlayback: vi.fn() });

    controller.begin('hosting');
    controller.dismissDialog();

    expect(stopHosting).toHaveBeenCalledOnce();
  });

  it('shows a toast for a new session message and auto-dismisses it', () => {
    vi.useFakeTimers();
    try {
      const session = createSession();
      const capture = captureSubscribe(session);
      const controller = createMultiplayerConnectionController({ session, pausePlayback: vi.fn() });

      capture.handler(sessionState({ connectionStatus: 'connected', message: 'Peer joined' }));

      expect(controller.getSnapshot().toastMessage).toBe('Peer joined');

      vi.advanceTimersByTime(9_000);

      expect(controller.getSnapshot().toastMessage).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('suppresses a repeated toast for the same message', () => {
    const session = createSession();
    const capture = captureSubscribe(session);
    const controller = createMultiplayerConnectionController({ session, pausePlayback: vi.fn() });

    capture.handler(sessionState({ connectionStatus: 'connected', message: 'Peer joined' }));
    capture.handler(sessionState({ connectionStatus: 'connected', message: 'Peer joined' }));

    expect(controller.getSnapshot().toastMessage).toBe('Peer joined');
  });

  it('clears the dialog when the session connects with no message', () => {
    const session = createSession();
    const capture = captureSubscribe(session);
    const controller = createMultiplayerConnectionController({ session, pausePlayback: vi.fn() });

    controller.begin('joining', 'Peer');
    capture.handler(sessionState({
      mode: 'client',
      connectionStatus: 'connected',
      message: null
    }));

    expect(controller.getSnapshot()).toMatchObject({
      dialogOpen: false,
      dialogError: null
    });
  });

  it('destroy unsubscribes from the session', () => {
    const unsubscribe = vi.fn();
    const session = createSession();
    session.subscribe = vi.fn(() => unsubscribe);
    const controller = createMultiplayerConnectionController({ session, pausePlayback: vi.fn() });

    controller.destroy();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
