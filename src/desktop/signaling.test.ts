import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';

const options = { port: 8787, publicUrl: '', upnp: false, iceUrls: [], allowedOrigins: [] };

beforeEach(() => { vi.resetModules(); vi.mocked(invoke).mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('native signaling build capability', () => {
  it.each([undefined, false])('omits native server calls when the shell reports %s', async (capability) => {
    vi.stubGlobal('window', { __izciBuiltinSignaling: capability });
    const signaling = await import('./signaling');
    expect(signaling.hasBuiltinSignaling).toBe(false);
    await expect(signaling.startBuiltinSignaling(options)).rejects.toThrow('unavailable in this build');
    await signaling.stopBuiltinSignaling();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('starts and stops the server only when the shell includes it', async () => {
    vi.stubGlobal('window', { __izciBuiltinSignaling: true });
    const signaling = await import('./signaling');
    const ready = { endpoint: 'http://127.0.0.1:8787' };
    vi.mocked(invoke).mockResolvedValue(ready);
    expect(signaling.hasBuiltinSignaling).toBe(true);
    await expect(signaling.startBuiltinSignaling(options)).resolves.toEqual(ready);
    expect(invoke).toHaveBeenCalledWith('start_builtin_signaling', { options });
    expect(signaling.isBuiltinSignalingEndpoint(ready.endpoint)).toBe(true);
    await signaling.stopBuiltinSignaling(ready.endpoint);
    expect(invoke).toHaveBeenLastCalledWith('stop_builtin_signaling', { endpoint: ready.endpoint });
    expect(signaling.isBuiltinSignalingEndpoint(ready.endpoint)).toBe(false);
  });
});
