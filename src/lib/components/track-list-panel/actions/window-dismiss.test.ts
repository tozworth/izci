import { afterEach, describe, expect, it, vi } from 'vitest';
import { windowDismiss } from './window-dismiss';

afterEach(() => vi.unstubAllGlobals());

describe('menu window dismissal', () => {
  function setup(dismissOnResize?: boolean) {
    const events = new EventTarget();
    vi.stubGlobal('window', events);
    const onDismiss = vi.fn();
    const action = windowDismiss({} as HTMLElement, { onDismiss, dismissOnResize });
    return { events, onDismiss, action };
  }

  it('dismisses ordinary menus when their window resizes', () => {
    const { events, onDismiss, action } = setup();
    events.dispatchEvent(new Event('resize'));
    expect(onDismiss).toHaveBeenCalledOnce();
    action.destroy();
  });

  it('keeps native popup menus open through sizing while retaining blur and Escape dismissal', () => {
    const { events, onDismiss, action } = setup(false);
    events.dispatchEvent(new Event('resize'));
    expect(onDismiss).not.toHaveBeenCalled();
    events.dispatchEvent(new Event('blur'));
    const escape = new Event('keydown');
    Object.defineProperty(escape, 'key', { value: 'Escape' });
    events.dispatchEvent(escape);
    expect(onDismiss).toHaveBeenCalledTimes(2);
    action.destroy();
  });

  it('uses updated resize preferences and removes its listeners on teardown', () => {
    const { events, onDismiss, action } = setup(false);
    action.update({ onDismiss, dismissOnResize: true });
    events.dispatchEvent(new Event('resize'));
    expect(onDismiss).toHaveBeenCalledOnce();
    action.destroy();
    events.dispatchEvent(new Event('resize'));
    events.dispatchEvent(new Event('blur'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
