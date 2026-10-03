import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleOdaOptionsKeydown } from './oda-options-keyboard';

class TestButton extends EventTarget {
  role = 'combobox';
  expanded = false;

  getAttribute(name: string): string | null {
    if (name === 'role') return this.role;
    if (name === 'aria-expanded') return String(this.expanded);
    return null;
  }
}

class TestInput extends EventTarget {
  type = 'checkbox';
  checked = false;
}

class TestKeyboardEvent extends Event {
  key: string;
  repeat: boolean;

  constructor(type: string, init: KeyboardEventInit) {
    super(type, init);
    this.key = init.key ?? '';
    this.repeat = init.repeat ?? false;
  }
}

function key(target: EventTarget, keyName: string, repeat = false): KeyboardEvent {
  const event = new TestKeyboardEvent('keydown', { key: keyName, repeat, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  return event as unknown as KeyboardEvent;
}

beforeEach(() => {
  vi.stubGlobal('HTMLButtonElement', TestButton);
  vi.stubGlobal('HTMLInputElement', TestInput);
  vi.stubGlobal('HTMLSelectElement', class extends EventTarget {});
  vi.stubGlobal('KeyboardEvent', TestKeyboardEvent);
});

afterEach(() => vi.unstubAllGlobals());

describe('Oda Options keyboard routing', () => {
  it('consumes repeated Up/Down navigation before closed selects can open', () => {
    const controls = [new TestButton(), new TestButton(), new TestButton()];
    let focused = 0;
    const move = vi.fn((_target, delta: number) => {
      focused = Math.min(Math.max(focused + delta, 0), controls.length - 1);
    });

    for (let press = 0; press < 5; press += 1) {
      const event = key(controls[focused], 'ArrowDown', press > 0);
      handleOdaOptionsKeydown(event, move);
      expect(event.defaultPrevented).toBe(true);
      expect(event.cancelBubble).toBe(true);
    }
    expect(focused).toBe(2);
    const up = key(controls[focused], 'ArrowUp');
    handleOdaOptionsKeydown(up, move);
    expect(focused).toBe(1);
    expect(up.cancelBubble).toBe(true);
  });

  it.each(['ArrowUp', 'ArrowDown', 'Enter', 'Escape'])(
    'lets an open select own %s without moving field focus',
    (keyName) => {
      const target = new TestButton();
      target.expanded = true;
      const event = key(target, keyName);
      const move = vi.fn();
      handleOdaOptionsKeydown(event, move);
      expect(move).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(event.cancelBubble).toBe(false);
    }
  );

  it('lets Enter reach a closed select to open it', () => {
    const event = key(new TestButton(), 'Enter');
    handleOdaOptionsKeydown(event, vi.fn());
    expect(event.defaultPrevented).toBe(false);
    expect(event.cancelBubble).toBe(false);
  });

  it.each(['OK', 'Select', ' ', 'Spacebar'])('translates %s to select activation', (keyName) => {
    const target = new TestButton();
    const received = vi.fn();
    target.addEventListener('keydown', received);
    const event = key(target, keyName);
    handleOdaOptionsKeydown(event, vi.fn());
    expect(event.cancelBubble).toBe(true);
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0].key).toBe('Enter');
  });

  it.each(['Back', 'BrowserBack', 'Backspace'])('uses %s to dismiss an open select first', (keyName) => {
    const target = new TestButton();
    target.expanded = true;
    const received = vi.fn();
    target.addEventListener('keydown', received);
    const event = key(target, keyName);
    handleOdaOptionsKeydown(event, vi.fn());
    expect(event.cancelBubble).toBe(true);
    expect(received.mock.calls[0][0].key).toBe('Escape');
  });

  it.each([false, true])('suppresses held OK when select expanded is %s', (expanded) => {
    const target = new TestButton();
    target.expanded = expanded;
    const received = vi.fn();
    target.addEventListener('keydown', received);
    const event = key(target, 'Enter', true);
    handleOdaOptionsKeydown(event, vi.fn());
    expect(event.defaultPrevented).toBe(true);
    expect(event.cancelBubble).toBe(true);
    expect(received).not.toHaveBeenCalled();
  });

  it('lets Back reach Oda navigation after the select is closed', () => {
    const event = key(new TestButton(), 'Back');
    handleOdaOptionsKeydown(event, vi.fn());
    expect(event.cancelBubble).toBe(false);
  });

  it('keeps checkbox adjustment on Left/Right and field navigation on Up/Down', () => {
    const target = new TestInput();
    const change = vi.fn();
    target.addEventListener('change', change);
    const move = vi.fn();
    handleOdaOptionsKeydown(key(target, 'ArrowRight'), move);
    expect(target.checked).toBe(true);
    expect(change).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
    handleOdaOptionsKeydown(key(target, 'ArrowDown'), move);
    expect(target.checked).toBe(true);
    expect(move).toHaveBeenCalledWith(target, 1);
  });
});
