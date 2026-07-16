import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PATTERN_VIEWER_SETTINGS,
  MAX_PATTERN_CHANNEL_WIDTH,
  MAX_PATTERN_FONT_SIZE,
  MIN_PATTERN_ROW_HEIGHT,
  normalizePatternViewerSettings
} from './pattern-viewer-settings';

describe('pattern viewer settings', () => {
  it('uses the complete defaults for missing values', () => {
    expect(normalizePatternViewerSettings(undefined)).toEqual(DEFAULT_PATTERN_VIEWER_SETTINGS);
  });

  it('clamps numeric settings and preserves explicit toggles', () => {
    expect(
      normalizePatternViewerSettings({
        fontSize: 99,
        rowHeight: 1,
        channelWidth: 999,
        rowNumberBase: 'decimal',
        colorScheme: 'monochrome',
        followPlayback: false,
        smoothScroll: true,
        showChannelNames: false,
        highlightBeatRows: false
      })
    ).toEqual({
      fontSize: MAX_PATTERN_FONT_SIZE,
      rowHeight: MIN_PATTERN_ROW_HEIGHT,
      channelWidth: MAX_PATTERN_CHANNEL_WIDTH,
      rowNumberBase: 'decimal',
      colorScheme: 'monochrome',
      followPlayback: false,
      smoothScroll: true,
      showChannelNames: false,
      highlightBeatRows: false
    });
  });

  it('falls back to conventional colors for unknown schemes', () => {
    expect(normalizePatternViewerSettings({ colorScheme: 'rainbow' }).colorScheme).toBe('conventional');
  });
});
