import { describe, expect, it } from 'vitest';
import { isMobileNavigator } from './mobile-device';

describe('isMobileNavigator', () => {
  it('uses User-Agent Client Hints when available', () => {
    expect(isMobileNavigator({ userAgentData: { mobile: true } })).toBe(true);
  });

  it('recognizes common mobile user agents', () => {
    expect(isMobileNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile' })).toBe(true);
    expect(isMobileNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true);
  });

  it('recognizes iPadOS desktop-class navigator values', () => {
    expect(isMobileNavigator({ platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
  });

  it('does not switch desktop browsers just because they support touch', () => {
    expect(isMobileNavigator({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      maxTouchPoints: 10
    })).toBe(false);
  });
});
