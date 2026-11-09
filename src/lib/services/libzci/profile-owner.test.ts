import { describe, expect, it, vi, afterEach } from 'vitest';
import { spawnProfileOwnerWorker } from './profile-owner';

describe('stub profile owner worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates the profile name before spawning', () => {
    expect(() => spawnProfileOwnerWorker('')).toThrow();
    expect(() => spawnProfileOwnerWorker('has space')).toThrow();
  });

  it('posts profile-init through the single import site', () => {
    const posted: unknown[] = [];
    const terminate = vi.fn();
    class MockWorker {
      onmessage: unknown = null;
      constructor(public url: URL, public options: { type: string }) {
        expect(String(url)).toContain('profile-owner.worker');
        expect(options).toEqual({ type: 'module' });
      }
      postMessage(message: unknown): void {
        posted.push(message);
      }
      terminate(): void {
        terminate();
      }
    }
    vi.stubGlobal('Worker', MockWorker as never);
    const handle = spawnProfileOwnerWorker('default');
    expect(handle.name).toBe('default');
    expect(posted).toEqual([{ type: 'profile-init', name: 'default' }]);
    handle.worker.terminate();
    expect(terminate).toHaveBeenCalledOnce();
  });
});
