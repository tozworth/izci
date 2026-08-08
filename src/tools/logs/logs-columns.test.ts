import { describe, expect, it } from 'vitest';

import type { LogEntry } from '$lib/services/logging';
import {
  compareLogEntries,
  fitLogWidthsToAvailableWidth,
  LOG_COLUMN_DEFAULT_WIDTHS,
  LOG_COLUMN_MIN_WIDTHS,
  LOG_SORT_DEFAULT,
  logsSort,
  normalizeLogColumnWidths,
  normalizeLogSort,
  rebalanceLogColumnWidths
} from './logs-columns';

function makeEntry(overrides: Partial<LogEntry> & { timestamp: number }): LogEntry {
  return {
    id: `test:${overrides.timestamp}`,
    level: 'info',
    source: 'system',
    window: 'main',
    message: `message ${overrides.timestamp}`,
    details: undefined,
    ...overrides
  };
}

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

  it('fits only the passed columns so hidden columns do not eat extra space', () => {
    const fitted = fitLogWidthsToAvailableWidth(
      LOG_COLUMN_DEFAULT_WIDTHS,
      900,
      ['time', 'level', 'message'] as const
    );

    const visibleTotal = fitted.time + fitted.level + fitted.message;
    const untouched = fitted.source + fitted.window + fitted.details;

    expect(visibleTotal).toBeCloseTo(900);
    expect(untouched).toBeCloseTo(
      LOG_COLUMN_DEFAULT_WIDTHS.source + LOG_COLUMN_DEFAULT_WIDTHS.window + LOG_COLUMN_DEFAULT_WIDTHS.details
    );
  });

  it('rebalances against the nearest visible neighbor only', () => {
    const hiddenWindow = ['time', 'level', 'source', 'message', 'details'] as const;
    const resized = rebalanceLogColumnWidths(LOG_COLUMN_DEFAULT_WIDTHS, 'source', 60, hiddenWindow);

    expect(resized.source).toBeCloseTo(LOG_COLUMN_DEFAULT_WIDTHS.source + 60);
    expect(resized.message).toBeCloseTo(LOG_COLUMN_DEFAULT_WIDTHS.message - 60);
    expect(resized.window).toBeCloseTo(LOG_COLUMN_DEFAULT_WIDTHS.window);
  });
});

describe('logs column sort', () => {
  it('normalizes sort state with a safe default', () => {
    expect(normalizeLogSort(undefined)).toEqual(LOG_SORT_DEFAULT);
    expect(normalizeLogSort({ columnId: 'level', direction: 'desc' })).toEqual({
      columnId: 'level',
      direction: 'desc'
    });
    expect(normalizeLogSort({ columnId: 'nope', direction: 'sideways' })).toEqual(LOG_SORT_DEFAULT);
  });

  it('sorts by time ascending by default and ties fall back to time', () => {
    const older = makeEntry({ timestamp: 100 });
    const newer = makeEntry({ timestamp: 200 });

    expect(compareLogEntries(older, newer, LOG_SORT_DEFAULT)).toBeLessThan(0);
    expect(compareLogEntries(newer, older, LOG_SORT_DEFAULT)).toBeGreaterThan(0);
  });

  it('sorts by level rank (error < warning < info < debug)', () => {
    const sort = { columnId: 'level' as const, direction: 'asc' as const };
    const error = makeEntry({ timestamp: 1, level: 'error' });
    const debug = makeEntry({ timestamp: 2, level: 'debug' });

    expect(compareLogEntries(error, debug, sort)).toBeLessThan(0);
    expect(compareLogEntries(debug, error, { ...sort, direction: 'desc' })).toBeLessThan(0);
  });

  it('sorts by message and keeps equal messages in chronological order', () => {
    const sort = { columnId: 'message' as const, direction: 'asc' as const };
    const first = makeEntry({ timestamp: 100, message: 'beta' });
    const second = makeEntry({ timestamp: 200, message: 'alpha' });
    const third = makeEntry({ timestamp: 300, message: 'beta' });

    expect(compareLogEntries(first, second, sort)).toBeGreaterThan(0);
    expect(compareLogEntries(first, third, sort)).toBeLessThan(0);
  });

  it('toggles direction when re-sorting the active column', () => {
    logsSort.setSort('time');
    expect(logsSort.getSnapshot().direction).toBe('desc');
    logsSort.setSort('time');
    expect(logsSort.getSnapshot().direction).toBe('asc');
    logsSort.setSort('source');
    expect(logsSort.getSnapshot()).toEqual({ columnId: 'source', direction: 'asc' });
    logsSort.reset();
  });
});
