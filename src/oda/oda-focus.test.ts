import { describe, expect, it, vi } from 'vitest';
import { createOdaFocusController } from './oda-focus';
import { createListFocusModel } from './oda-navigation';

function key(keyName: string, repeat = false): KeyboardEvent {
  return { key: keyName, repeat } as KeyboardEvent;
}

function createController(options: {
  wrap?: boolean;
  holdAction?: 'none' | 'return-home';
  thresholdMs?: number;
} = {}) {
  const focusChanges: Array<string | null> = [];
  const handlers = {
    onActivate: vi.fn(),
    onBack: vi.fn(),
    onHoldBack: vi.fn(),
    onTransport: vi.fn()
  };
  const timers: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = [];
  const controller = createOdaFocusController({
    getWrap: () => options.wrap ?? false,
    getRepeatInitialDelayMs: () => 400,
    getRepeatIntervalMs: () => 100,
    getHoldBack: () => ({
      action: options.holdAction ?? 'return-home',
      thresholdMs: options.thresholdMs ?? 800
    }),
    onFocusChange: (focusId) => focusChanges.push(focusId),
    schedule: (callback, delayMs) => {
      timers.push({ callback, delayMs, cancelled: false });
      return timers.length - 1;
    },
    cancel: (handle) => {
      timers[handle].cancelled = true;
    }
  });
  controller.setHandlers(handlers);
  return { controller, handlers, focusChanges, timers };
}

describe('createOdaFocusController', () => {
  it('moves through the active model and reports focus changes', () => {
    const { controller, focusChanges } = createController();
    controller.setModel(createListFocusModel(['a', 'b', 'c']));
    controller.setFocus('a');

    expect(controller.handleKeydown(key('ArrowDown'))).toBe(true);
    expect(controller.getFocus()).toBe('b');
    controller.handleKeydown(key('ArrowDown'));
    expect(controller.getFocus()).toBe('c');
    controller.handleKeydown(key('ArrowDown'));
    expect(controller.getFocus()).toBe('c');

    expect(focusChanges).toEqual(['a', 'b', 'c']);
  });

  it('honors the wrap setting through the getter', () => {
    const wrapped = createController({ wrap: true });
    wrapped.controller.setModel(createListFocusModel(['a', 'b']));
    wrapped.controller.setFocus('b');
    wrapped.controller.handleKeydown(key('ArrowDown'));
    expect(wrapped.controller.getFocus()).toBe('a');
  });

  it('resolves a null focus to the first entry on the first move', () => {
    const { controller } = createController();
    controller.setModel(createListFocusModel(['a', 'b']));
    controller.setFocus(null);
    controller.handleKeydown(key('ArrowDown'));
    expect(controller.getFocus()).toBe('a');
  });

  it('ignores OS repeat for directional keys', () => {
    const { controller } = createController();
    controller.setModel(createListFocusModel(['a', 'b']));
    controller.setFocus('a');
    expect(controller.handleKeydown(key('ArrowDown', true))).toBe(true);
    expect(controller.getFocus()).toBe('a');
  });

  it('activates the focused item and ignores activation key-repeat', () => {
    const { controller, handlers } = createController();
    controller.setModel(createListFocusModel(['a', 'b']));
    controller.setFocus('b');

    controller.handleKeydown(key('Enter'));
    expect(handlers.onActivate).toHaveBeenCalledWith('b');

    controller.handleKeydown(key('Enter', true));
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onBack).not.toHaveBeenCalled();
  });

  it('fires Back on release and the hold action after the threshold', () => {
    const { controller, handlers, timers } = createController({ holdAction: 'return-home', thresholdMs: 800 });
    controller.setModel(createListFocusModel(['a']));

    controller.handleKeydown(key('Escape'));
    expect(timers[0].delayMs).toBe(800);
    timers[0].callback();
    expect(handlers.onHoldBack).toHaveBeenCalledTimes(1);
    expect(handlers.onBack).not.toHaveBeenCalled();

    controller.handleKeyup(key('Escape'));
    expect(handlers.onBack).not.toHaveBeenCalled();
  });

  it('fires Back on a short tap', () => {
    const { controller, handlers, timers } = createController({ holdAction: 'return-home' });
    controller.handleKeydown(key('Escape'));
    controller.handleKeyup(key('Escape'));
    expect(timers[0].cancelled).toBe(true);
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onHoldBack).not.toHaveBeenCalled();
  });

  it('stays on Back when the hold action is none', () => {
    const { controller, handlers, timers } = createController({ holdAction: 'none' });
    controller.handleKeydown(key('Escape'));
    timers[0].callback();
    expect(handlers.onHoldBack).not.toHaveBeenCalled();
    controller.handleKeyup(key('Escape'));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it('completes a pending Back tap on browser fullscreen exit without double-firing', () => {
    const { controller, handlers } = createController();
    controller.setModel(createListFocusModel(['a']));

    controller.handleKeydown(key('Escape'));
    controller.handleBrowserFullscreenExit();
    expect(handlers.onBack).toHaveBeenCalledTimes(1);

    // The swallowed press's late keyup (if ever delivered) must not fire again.
    controller.handleKeyup(key('Escape'));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it('ignores browser fullscreen exits with no pending Back press', () => {
    const { controller, handlers } = createController();
    controller.setModel(createListFocusModel(['a']));

    controller.handleBrowserFullscreenExit();
    expect(handlers.onBack).not.toHaveBeenCalled();
    expect(handlers.onHoldBack).not.toHaveBeenCalled();
  });

  it('prefers the hold action over the tap when fullscreen exits after the threshold', () => {
    const { controller, handlers, timers } = createController({ holdAction: 'return-home', thresholdMs: 800 });
    controller.setModel(createListFocusModel(['a']));

    controller.handleKeydown(key('Escape'));
    timers[0].callback();
    expect(handlers.onHoldBack).toHaveBeenCalledTimes(1);

    controller.handleBrowserFullscreenExit();
    expect(handlers.onBack).not.toHaveBeenCalled();

    controller.handleKeyup(key('Escape'));
    expect(handlers.onBack).not.toHaveBeenCalled();
    expect(handlers.onHoldBack).toHaveBeenCalledTimes(1);
  });

  it('passes input through when no model is active', () => {
    const { controller, handlers } = createController();
    controller.setModel(null);

    expect(controller.handleKeydown(key('ArrowDown'))).toBe(false);
    expect(controller.handleKeydown(key('Enter'))).toBe(false);
    expect(controller.handleKeydown(key('Escape'))).toBe(true);
    controller.handleKeyup(key('Escape'));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it('routes media keys as transport actions', () => {
    const { controller, handlers } = createController();
    controller.setModel(createListFocusModel(['a']));
    expect(controller.handleKeydown(key('MediaPlayPause'))).toBe(true);
    expect(controller.handleKeydown(key('MediaTrackNext'))).toBe(true);
    expect(handlers.onTransport).toHaveBeenNthCalledWith(1, 'play-pause');
    expect(handlers.onTransport).toHaveBeenNthCalledWith(2, 'next');
  });

  it('reports unconsumed keys', () => {
    const { controller } = createController();
    expect(controller.handleKeydown(key('a'))).toBe(false);
    expect(controller.handleKeydown(key('F5'))).toBe(false);
  });
});
