import { describe, expect, it } from 'vitest';
import { formatDiagnosticsExport } from './logs-export';

describe('diagnostics export', () => {
  it('contains version, timestamp, level, source, context, message, and details', () => {
    const output = formatDiagnosticsExport([{
      id: 'main:test:1', correlationId: 'main:correlation:1', originId: 'main:test',
      timestamp: Date.UTC(2026, 0, 2, 3, 4, 5, 6), level: 'warning',
      source: 'files', context: 'main', message: 'Permission required', details: '{"name":"Music"}'
    }]);
    expect(output).toContain('version:');
    expect(output).toContain('2026-01-02T03:04:05.006Z');
    expect(output).toContain('[warning] [files] [main] Permission required {"name":"Music"}');
  });
});
