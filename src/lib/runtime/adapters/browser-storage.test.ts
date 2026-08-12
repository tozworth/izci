import { describe, expect, it, vi } from 'vitest';
import { BrowserKeyValueStorage } from './browser-storage';

describe('BrowserKeyValueStorage', () => {
  it('distinguishes browser-blocked storage from file permission denial', () => {
    const storage = new BrowserKeyValueStorage(() => {
      throw { name: 'SecurityError', message: 'Storage access is blocked' };
    });

    expect(() => storage.read('theme')).toThrowError(expect.objectContaining({
      category: 'blocked',
      code: 'runtime.storage-read-failed',
      operation: 'read setting theme',
      retryable: true
    }));
  });

  it('keeps quota exhaustion distinct', () => {
    const storage = new BrowserKeyValueStorage(() => ({
      getItem() { return null; },
      setItem() { throw { name: 'QuotaExceededError', message: 'full' }; }
    } as unknown as Storage));

    expect(() => storage.write('settings', '{}')).toThrowError(expect.objectContaining({
      category: 'quota', code: 'runtime.storage-write-failed'
    }));
  });

  it('publishes accepted local writes and removes subscriptions idempotently', () => {
    const values = new Map<string, string>();
    const storage = new BrowserKeyValueStorage(() => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); }
    } as unknown as Storage));
    const listener = vi.fn();
    const unsubscribe = storage.subscribe(listener);

    storage.write('theme', 'dark');
    storage.remove('theme');
    unsubscribe();
    unsubscribe();
    storage.write('theme', 'light');

    expect(listener.mock.calls.map(([change]) => change)).toEqual([
      { key: 'theme', oldValue: null, newValue: 'dark', source: 'local' },
      { key: 'theme', oldValue: 'dark', newValue: null, source: 'local' }
    ]);
  });
});
