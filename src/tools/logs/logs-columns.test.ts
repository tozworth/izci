import { describe, expect, it } from 'vitest';
import type { LogEntry } from '$lib/services/logging';
import { compareLogEntries, formatLogTimestamp } from './logs-columns';

function entry(id: string, timestamp: number): LogEntry {
  return { id, timestamp, level: 'info', source: 'system', context: 'main', message: id };
}

describe('log time column', () => {
  it('shows the complete clock time including milliseconds', () => {
    const timestamp = Date.UTC(2026, 0, 2, 3, 4, 5, 688);

    expect(formatLogTimestamp(timestamp, 'en-GB')).toMatch(/^\d{2}:\d{2}:\d{2}\.688$/);
  });

  it('sorts by the complete timestamp across second boundaries', () => {
    const earlier = entry('earlier', 1_000);
    const later = entry('later', 1_001);

    expect(compareLogEntries(later, earlier, { columnId: 'time', direction: 'asc' })).toBeGreaterThan(0);
    expect(compareLogEntries(later, earlier, { columnId: 'time', direction: 'desc' })).toBeLessThan(0);
  });
});
