import { describe, expect, it } from 'vitest';
import { resolveMobileSwipeDestination } from './mobile-navigation';

describe('resolveMobileSwipeDestination', () => {
  it('includes Now Playing between Library and Lyrics', () => {
    expect(resolveMobileSwipeDestination('library', 1)).toBe('now-playing');
    expect(resolveMobileSwipeDestination('lyrics', -1)).toBe('now-playing');
  });

  it('moves away from Now Playing one destination at a time', () => {
    expect(resolveMobileSwipeDestination('now-playing', -1)).toBe('library');
    expect(resolveMobileSwipeDestination('now-playing', 1)).toBe('lyrics');
  });

  it('stops at the ends', () => {
    expect(resolveMobileSwipeDestination('playlist', -1)).toBeNull();
    expect(resolveMobileSwipeDestination('details', 1)).toBeNull();
  });
});
