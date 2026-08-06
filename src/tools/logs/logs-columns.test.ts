import { describe, expect, it } from 'vitest';

import {
  fitLogWidthsToAvailableWidth,
  LOG_COLUMN_DEFAULT_WIDTHS,
  LOG_COLUMN_MIN_WIDTHS,
  normalizeLogColumnWidths,
  rebalanceLogColumnWidths
} from './logs-columns';

describe('logs column helpers', () => {
  it('normalizes stored widths, clamping to minimums and filling gaps with defaults', () => {
    expect(normalizeLogColumnWidths(undefined)).toEqual(LOG_COLUMN_DEFAULT_WIDTHS);
    expect(normalizeLogColumnWidths(null)).toEqual(LOG_COLUMN_DEFAULT_WIDTHS);
    expect(
      normalizeLogColumnWidths({
        time: 20,
        level: 200,
        window: 'wide',
        message: 333.6
      })
    ).toEqual({
      ...LOG_COLUMN_DEFAULT_WIDTHS,
      time: LOG_COLUMN_MIN_WIDTHS.time,
      level: 200,
      message: 334
    });
    expect(normalizeLogColumnWidths('garbage')).toEqual(LOG_COLUMN_DEFAULT_WIDTHS);
  });

  it('distributes extra space proportionally when the popup is wider than the defaults', () => {
    const fitted = fitLogWidthsToAvailableWidth(LOG_COLUMN_DEFAULT_WIDTHS, 1040);
    const total = Object.values(fitted).reduce((sum, width) => sum + width, 0);

    expect(total).toBeCloseTo(1040);
    expect(fitted.message).toBeGreaterThan(LOG_COLUMN_DEFAULT_WIDTHS.message);
    expect(fitted.details).toBeGreaterThan(LOG_COLUMN_DEFAULT_WIDTHS.details);
  });

  it('shrinks columns toward minimums when the popup is narrower than the defaults', () => {
    const fitted = fitLogWidthsToAvailableWidth(LOG_COLUMN_DEFAULT_WIDTHS, 640);
    const total = Object.values(fitted).reduce((sum, width) => sum + width, 0);

    expect(total).toBeCloseTo(640);
    expect(fitted.time).toBeLessThan(LOG_COLUMN_DEFAULT_WIDTHS.time);
    expect(fitted.time).toBeGreaterThanOrEqual(LOG_COLUMN_MIN_WIDTHS.time);
    expect(fitted.message).toBeGreaterThanOrEqual(LOG_COLUMN_MIN_WIDTHS.message);
  });

  it('scales below minimums rather than overflowing a tiny popup', () => {
    const fitted = fitLogWidthsToAvailableWidth(LOG_COLUMN_DEFAULT_WIDTHS, 120);
    const total = Object.values(fitted).reduce((sum, width) => sum + width, 0);

    expect(total).toBeLessThanOrEqual(120.5);
    expect(Object.values(fitted).every((width) => width >= 1)).toBe(true);
  });

  it('rebalances a widened column against its right neighbor', () => {
    const resized = rebalanceLogColumnWidths(LOG_COLUMN_DEFAULT_WIDTHS, 'message', 100);

    expect(resized.message).toBeCloseTo(LOG_COLUMN_DEFAULT_WIDTHS.message + 100);
    expect(resized.details).toBeCloseTo(LOG_COLUMN_DEFAULT_WIDTHS.details - 100);
    expect(resized.time).toBeCloseTo(LOG_COLUMN_DEFAULT_WIDTHS.time);
  });

  it('cascades to the next neighbor when the nearest reaches its minimum', () => {
    const narrowDetails = {
      ...LOG_COLUMN_DEFAULT_WIDTHS,
      details: LOG_COLUMN_MIN_WIDTHS.details
    };
    const resized = rebalanceLogColumnWidths(narrowDetails, 'message', 80);

    expect(resized.details).toBeCloseTo(LOG_COLUMN_MIN_WIDTHS.details);
    expect(resized.window).toBeCloseTo(LOG_COLUMN_MIN_WIDTHS.window);
    expect(resized.source).toBeCloseTo(LOG_COLUMN_DEFAULT_WIDTHS.source - (80 - (LOG_COLUMN_DEFAULT_WIDTHS.window - LOG_COLUMN_MIN_WIDTHS.window)));
  });

  it('hands a narrowed column its space to the nearest neighbor', () => {
    const resized = rebalanceLogColumnWidths(LOG_COLUMN_DEFAULT_WIDTHS, 'source', -40);

    expect(resized.source).toBeCloseTo(LOG_COLUMN_DEFAULT_WIDTHS.source - 40);
    expect(resized.window).toBeCloseTo(LOG_COLUMN_DEFAULT_WIDTHS.window + 40);
  });

  it('keeps the resized column at its minimum when the delta overshoots', () => {
    const resized = rebalanceLogColumnWidths(LOG_COLUMN_DEFAULT_WIDTHS, 'level', -9999);

    expect(resized.level).toBeCloseTo(LOG_COLUMN_MIN_WIDTHS.level);
    expect(resized.source).toBeCloseTo(
      LOG_COLUMN_DEFAULT_WIDTHS.source + LOG_COLUMN_DEFAULT_WIDTHS.level - LOG_COLUMN_MIN_WIDTHS.level
    );
  });
});
