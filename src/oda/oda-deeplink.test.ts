import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeOdaDeeplink,
  isOdaDeeplinkHash,
  isOdaDeeplinkPath,
  watchOdaDeeplink
} from './oda-deeplink';

describe('isOdaDeeplinkHash', () => {
  it('accepts the bare marker', () => {
    expect(isOdaDeeplinkHash('#oda')).toBe(true);
    expect(isOdaDeeplinkHash('#oda/')).toBe(true);
    expect(isOdaDeeplinkHash('#ODA')).toBe(true);
  });

  it('rejects other fragments and deeper specs', () => {
    expect(isOdaDeeplinkHash('')).toBe(false);
    expect(isOdaDeeplinkHash('odalink')).toBe(false);
    expect(isOdaDeeplinkHash('#odadog')).toBe(false);
    expect(isOdaDeeplinkHash('#join=abcd1234')).toBe(false);
    expect(isOdaDeeplinkHash('#oda/queue')).toBe(false);
  });
});

describe('isOdaDeeplinkPath', () => {
  it('accepts the marker path', () => {
    expect(isOdaDeeplinkPath('/oda')).toBe(true);
    expect(isOdaDeeplinkPath('/oda/')).toBe(true);
    expect(isOdaDeeplinkPath('/ODA')).toBe(true);
  });

  it('rejects every other path, tool pages included', () => {
    expect(isOdaDeeplinkPath('/')).toBe(false);
    expect(isOdaDeeplinkPath('')).toBe(false);
    expect(isOdaDeeplinkPath('/odalink')).toBe(false);
    expect(isOdaDeeplinkPath('/oda/queue')).toBe(false);
    expect(isOdaDeeplinkPath('/options.html')).toBe(false);
    expect(isOdaDeeplinkPath('/troubadour.html')).toBe(false);
  });
});

describe('consumeOdaDeeplink', () => {
  function makeStub(hash: string, search = '', pathname = '/') {
    const replaced: string[] = [];
    return {
      location: { hash, search, pathname },
      history: {
        replaceState(_state: unknown, _title: string, url?: string) {
          replaced.push(url ?? '');
        }
      },
      replaced
    };
  }

  it('reports the hash marker and strips it, keeping the query', () => {
    const stub = makeStub('#oda', '?filelaunch');
    expect(consumeOdaDeeplink(stub.location, stub.history)).toBe(true);
    expect(stub.replaced).toEqual(['/?filelaunch']);
  });

  it('reports the path marker and strips it back to the app root', () => {
    const stub = makeStub('#join=abcd1234', '?filelaunch', '/oda');
    expect(consumeOdaDeeplink(stub.location, stub.history)).toBe(true);
    expect(stub.replaced).toEqual(['/?filelaunch#join=abcd1234']);
  });

  it('leaves the URL untouched when no marker is present', () => {
    const stub = makeStub('#join=abcd1234', '?filelaunch', '/');
    expect(consumeOdaDeeplink(stub.location, stub.history)).toBe(false);
    expect(stub.replaced).toEqual([]);
  });

  it('still enters when the history API refuses the strip', () => {
    const throwing = {
      replaceState() {
        throw new Error('blocked');
      }
    };
    expect(consumeOdaDeeplink({ hash: '#oda', search: '', pathname: '/' }, throwing)).toBe(true);
  });
});

describe('watchOdaDeeplink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubWindow(hash: string) {
    const listeners = new Map<string, () => void>();
    const replaced: string[] = [];
    vi.stubGlobal('window', {
      location: { hash, search: '', pathname: '/' },
      history: {
        replaceState(_state: unknown, _title: string, url?: string) {
          replaced.push(url ?? '');
        }
      },
      addEventListener(type: string, listener: () => void) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      }
    });
    return { listeners, replaced };
  }

  it('reports a link followed while the app is open and consumes it', () => {
    const { listeners, replaced } = stubWindow('#oda');
    let requested = 0;
    const unsubscribe = watchOdaDeeplink(() => {
      requested += 1;
    });

    listeners.get('hashchange')?.();

    expect(requested).toBe(1);
    expect(replaced).toEqual(['/']);

    unsubscribe();
    expect(listeners.has('hashchange')).toBe(false);
  });

  it('stays silent when the fragment is not the Oda marker', () => {
    const { listeners, replaced } = stubWindow('#join=abcd1234');
    let requested = 0;
    watchOdaDeeplink(() => {
      requested += 1;
    });

    listeners.get('hashchange')?.();

    expect(requested).toBe(0);
    expect(replaced).toEqual([]);
  });
});
