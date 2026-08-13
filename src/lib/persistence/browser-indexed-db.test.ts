import { describe, expect, it, vi } from 'vitest';
import {
  disposeBrowserPersistenceOwners,
  registerBrowserPersistenceOwner
} from './browser-indexed-db';

describe('browser persistence owner shutdown', () => {
  it('flushes every owner before disposing it and unregisters the batch', async () => {
    const events: string[] = [];
    registerBrowserPersistenceOwner({
      label: 'first',
      flush: () => { events.push('first:flush'); },
      dispose: () => { events.push('first:dispose'); }
    });
    registerBrowserPersistenceOwner({
      label: 'second',
      flush: async () => { events.push('second:flush'); },
      dispose: async () => { events.push('second:dispose'); }
    });

    await disposeBrowserPersistenceOwners();
    expect(events).toEqual([
      'first:flush',
      'second:flush',
      'first:dispose',
      'second:dispose'
    ]);

    events.length = 0;
    await disposeBrowserPersistenceOwners();
    expect(events).toEqual([]);
  });

  it('settles all owners before reporting aggregate shutdown failures', async () => {
    const disposeSecond = vi.fn();
    registerBrowserPersistenceOwner({
      label: 'broken',
      flush: () => { throw new Error('quota'); },
      dispose: vi.fn()
    });
    registerBrowserPersistenceOwner({
      label: 'healthy',
      dispose: disposeSecond
    });

    await expect(disposeBrowserPersistenceOwners()).rejects.toBeInstanceOf(AggregateError);
    expect(disposeSecond).toHaveBeenCalledOnce();
  });
});
