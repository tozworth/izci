import { describe, expect, it } from 'vitest';
import type { MultiplayerClient } from './multiplayer-types';
import {
  createMultiplayerFloaterPlacement,
  getMultiplayerClientIcon,
  isMultiplayerFloaterVisible
} from './now-playing-multiplayer';

function client(patch: Partial<MultiplayerClient> = {}): MultiplayerClient {
  return {
    id: 'client-a',
    name: 'Listener',
    platform: 'Windows',
    status: 'connected',
    paired: false,
    freeplayPaired: false,
    freeplay: false,
    freeplayTrack: null,
    freeplayPlaybackState: 'idle',
    freeplayArtworkUrl: null,
    ...patch
  };
}

describe('Now Playing Multiplayer floaters', () => {
  it('keeps stable placements in the outer edge bands', () => {
    const first = createMultiplayerFloaterPlacement('client-a', 0, 42);
    expect(createMultiplayerFloaterPlacement('client-a', 0, 42)).toEqual(first);
    expect(['left', 'right', 'top', 'bottom']).toContain(first.edge);
    expect(first.offsetPercent).toBeGreaterThanOrEqual(5);
    expect(first.offsetPercent).toBeLessThanOrEqual(82);
  });

  it('chooses a device-shaped icon when the platform reveals one', () => {
    expect(getMultiplayerClientIcon('Android')).toBe('smartphone');
    expect(getMultiplayerClientIcon('iPad')).toBe('tablet_mac');
    expect(getMultiplayerClientIcon('Windows')).toBe('computer');
  });

  it('shows connected co-op clients without requiring track information', () => {
    expect(isMultiplayerFloaterVisible(client())).toBe(true);
    expect(isMultiplayerFloaterVisible(client({ status: 'disconnected' }))).toBe(false);
  });

  it('shows Freeplay clients only while they have active track information', () => {
    expect(isMultiplayerFloaterVisible(client({ freeplay: true }))).toBe(false);
    expect(isMultiplayerFloaterVisible(client({
      freeplay: true,
      freeplayTrack: { id: 'track-a' } as MultiplayerClient['freeplayTrack'],
      freeplayPlaybackState: 'playing'
    }))).toBe(true);
  });
});
