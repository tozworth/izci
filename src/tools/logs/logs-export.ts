import { version as appVersion } from '../../../package.json';
import type { LogEntry } from '$lib/services/logging';

export function formatLogTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function formatLogLine(entry: LogEntry): string {
  return `${formatLogTimestamp(entry.timestamp)} [${entry.level}] [${entry.source}] [${entry.context}] ${entry.message}${entry.details ? ` ${entry.details}` : ''}`;
}

export function formatDiagnosticsExport(entries: readonly LogEntry[]): string {
  const header = [
    `izci diagnostics`,
    `version: ${appVersion}`,
    `exported: ${new Date().toISOString()}`,
    `entries: ${entries.length}`,
    ''
  ];
  return `${header.join('\n')}${entries.map(formatLogLine).join('\n')}${entries.length ? '\n' : ''}`;
}
