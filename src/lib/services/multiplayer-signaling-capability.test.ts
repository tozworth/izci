import { describe, expect, it, vi } from 'vitest';

vi.mock('$platform', () => ({ isDesktop: true, hasBuiltinSignaling: false }));
import { DEFAULT_MULTIPLAYER_SETTINGS } from '$lib/stores/multiplayer-settings';
import { normalizeServerInviteEndpoint } from './multiplayer-server-invite';

describe('ordinary desktop signaling', () => {
  it('defaults to external hosting', () => {
    expect(DEFAULT_MULTIPLAYER_SETTINGS.multiplayerSignaling).toBe('external');
  });

  it('accepts HTTPS and loopback endpoints without native transport', () => {
    expect(normalizeServerInviteEndpoint('https://signal.example.com/')).toBe('https://signal.example.com');
    expect(normalizeServerInviteEndpoint('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  });

  it('requires a signaling build for plain HTTP outside loopback', () => {
    expect(() => normalizeServerInviteEndpoint('http://192.168.1.42:8787')).toThrow('desktop-required');
  });
});
