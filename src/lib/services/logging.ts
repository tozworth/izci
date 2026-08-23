import { version as appVersion } from '../../../package.json';
import { loggingSettings } from '$lib/stores/logging-settings';

export type LogLevel = 'error' | 'warning' | 'info' | 'debug';
export type LogSource =
  | 'system'
  | 'playback'
  | 'decode'
  | 'files'
  | 'library'
  | 'tools'
  | 'multiplayer'
  | 'freeplay';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  context: string;
  message: string;
  details?: string;
}

export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warning', 'info', 'debug'];
export const LOG_SOURCES: readonly LogSource[] = [
  'system', 'playback', 'decode', 'files', 'library', 'tools', 'multiplayer', 'freeplay'
];
export const MAX_LOG_ENTRIES = 3000;
export const LOG_CHANNEL_NAME = 'izci-logs-v2';

const MAX_MESSAGE_LENGTH = 4096;
const MAX_DETAILS_LENGTH = 32768;
const BENIGN_GLOBAL_ERROR_MESSAGES = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded'
]);

interface ChannelLike {
  postMessage(message: LogChannelMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

type LogChannelMessage =
  | { type: 'entry'; entry: LogEntry }
  | { type: 'history-request'; requestId: string; requesterId: string }
  | { type: 'history-response'; requestId: string; responderId: string; entries: LogEntry[] }
  | { type: 'clear'; requestId: string };

export interface LoggingRuntimeOptions {
  context?: string;
  instanceId?: string;
  now?: () => number;
  channelFactory?: () => ChannelLike | null;
  scheduleNotification?: (callback: () => void) => void;
  settings?: () => { captureDebug: boolean; mirrorToConsole: boolean };
}

export interface LoggingRuntime {
  init(): void;
  destroy(): void;
  log(level: LogLevel, source: LogSource, message: string, details?: unknown): LogEntry | null;
  getEntries(): LogEntry[];
  getOwnEntries(): LogEntry[];
  subscribe(listener: (entries: LogEntry[]) => void): () => void;
  requestHistory(): string;
  clear(): void;
}

function randomToken(): string {
  try {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export function getLoggingContext(path = typeof location === 'undefined' ? '' : location.pathname): string {
  if (path.endsWith('troubadour-options.html')) return 'troubadour-options';
  if (path.endsWith('audio-compare.html')) return 'audio-compare';
  if (path.endsWith('options.html')) return 'options';
  if (path.endsWith('troubadour.html')) return 'troubadour';
  if (path.endsWith('editor.html')) return 'editor';
  if (path.endsWith('converter.html')) return 'converter';
  if (path.endsWith('logs.html')) return 'logs';
  if (path.endsWith('index.html') || path === '/' || path === '') return 'main';
  return 'window';
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

export function normalizeLogDetails(details: unknown): string | undefined {
  if (details === undefined || details === null) return undefined;
  if (typeof details === 'string') return truncate(details, MAX_DETAILS_LENGTH);

  if (details instanceof Error) {
    return truncate(JSON.stringify({
      name: details.name,
      message: details.message,
      stack: details.stack
    }), MAX_DETAILS_LENGTH);
  }

  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(details, (_key, value: unknown) => {
      if (typeof value === 'bigint') return `${value}n`;
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
    if (serialized !== undefined) return truncate(serialized, MAX_DETAILS_LENGTH);
  } catch {
    // Fall back to a string below. Logging must never surface serialization failures.
  }

  try {
    return truncate(String(details), MAX_DETAILS_LENGTH);
  } catch {
    return '[Unserializable details]';
  }
}

function isValidEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LogEntry>;
  return typeof entry.id === 'string'
    && typeof entry.timestamp === 'number'
    && Number.isFinite(entry.timestamp)
    && typeof entry.context === 'string'
    && typeof entry.message === 'string'
    && (entry.details === undefined || typeof entry.details === 'string')
    && LOG_LEVELS.includes(entry.level as LogLevel)
    && LOG_SOURCES.includes(entry.source as LogSource);
}

function capNewest(entries: LogEntry[]): LogEntry[] {
  if (entries.length <= MAX_LOG_ENTRIES) return entries;
  entries.sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
  return entries.slice(entries.length - MAX_LOG_ENTRIES);
}

export function createLoggingRuntime(options: LoggingRuntimeOptions = {}): LoggingRuntime {
  const context = options.context ?? getLoggingContext();
  const instanceId = options.instanceId ?? randomToken();
  const now = options.now ?? Date.now;
  const scheduleNotification = options.scheduleNotification ?? ((callback) => queueMicrotask(callback));
  const getSettings = options.settings ?? (() => loggingSettings.getSnapshot());
  const channelFactory = options.channelFactory ?? (() => {
    if (typeof BroadcastChannel === 'undefined') return null;
    try {
      return new BroadcastChannel(LOG_CHANNEL_NAME) as ChannelLike;
    } catch {
      return null;
    }
  });

  let sequence = 0;
  let requestSequence = 0;
  let initialized = false;
  let destroyed = false;
  let channel: ChannelLike | null = null;
  let notificationPending = false;
  let collecting = false;
  let ownEntries: LogEntry[] = [];
  let collectedEntries: LogEntry[] = [];
  const collectedIds = new Set<string>();
  const listeners = new Set<(entries: LogEntry[]) => void>();
  const activeRequestIds = new Set<string>();
  const answeredRequestIds = new Set<string>();
  const acceptedResponses = new Set<string>();

  function ensureChannel(): ChannelLike | null {
    if (channel || destroyed) return channel;
    channel = channelFactory();
    channel?.addEventListener('message', handleChannelMessage);
    return channel;
  }

  function post(message: LogChannelMessage): void {
    try {
      ensureChannel()?.postMessage(message);
    } catch {
      // BroadcastChannel availability and structured-clone failures never break local logging.
    }
  }

  function notifyNow(): void {
    notificationPending = false;
    if (listeners.size === 0) return;
    const snapshot = collectedEntries.slice();
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* Subscriber faults stay isolated. */ }
    }
  }

  function scheduleNotify(): void {
    if (notificationPending || listeners.size === 0) return;
    notificationPending = true;
    scheduleNotification(notifyNow);
  }

  function rebuildCollectedIds(): void {
    collectedIds.clear();
    for (const entry of collectedEntries) collectedIds.add(entry.id);
  }

  function mergeCollected(entries: readonly LogEntry[]): void {
    if (!collecting || entries.length === 0) return;
    let changed = false;
    for (const entry of entries) {
      if (collectedIds.has(entry.id)) continue;
      collectedIds.add(entry.id);
      collectedEntries.push(entry);
      changed = true;
    }
    if (!changed) return;
    collectedEntries = capNewest(collectedEntries);
    rebuildCollectedIds();
    scheduleNotify();
  }

  function rememberBounded(set: Set<string>, value: string): boolean {
    if (set.has(value)) return false;
    set.add(value);
    if (set.size > 128) set.delete(set.values().next().value as string);
    return true;
  }

  function handleChannelMessage(event: MessageEvent<unknown>): void {
    const message = event.data;
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const typed = message as Partial<LogChannelMessage> & Record<string, unknown>;

    if (typed.type === 'entry') {
      if (isValidEntry(typed.entry)) mergeCollected([typed.entry]);
      return;
    }

    if (typed.type === 'history-request') {
      if (typeof typed.requestId !== 'string' || typeof typed.requesterId !== 'string') return;
      if (typed.requesterId === instanceId || !rememberBounded(answeredRequestIds, typed.requestId)) return;
      post({
        type: 'history-response',
        requestId: typed.requestId,
        responderId: instanceId,
        entries: ownEntries.slice()
      });
      return;
    }

    if (typed.type === 'history-response') {
      if (typeof typed.requestId !== 'string' || typeof typed.responderId !== 'string') return;
      if (!activeRequestIds.has(typed.requestId) || !Array.isArray(typed.entries)) return;
      const responseKey = `${typed.requestId}:${typed.responderId}`;
      if (!rememberBounded(acceptedResponses, responseKey)) return;
      mergeCollected(typed.entries.filter(isValidEntry).slice(-MAX_LOG_ENTRIES));
      return;
    }

    if (typed.type === 'clear' && typeof typed.requestId === 'string') {
      if (!rememberBounded(answeredRequestIds, `clear:${typed.requestId}`)) return;
      ownEntries = [];
      if (collecting) {
        collectedEntries = [];
        rebuildCollectedIds();
        scheduleNotify();
      }
    }
  }

  function mirror(entry: LogEntry): void {
    if (!getSettings().mirrorToConsole || typeof console === 'undefined') return;
    const prefix = `[izci:${entry.level}] [${entry.source}] [${entry.context}]`;
    const values = entry.details ? [prefix, entry.message, entry.details] : [prefix, entry.message];
    try {
      if (entry.level === 'error') console.error(...values);
      else if (entry.level === 'warning') console.warn(...values);
      else if (entry.level === 'debug') console.debug(...values);
      else console.info(...values);
    } catch {
      // Console shims and test doubles cannot compromise logging.
    }
  }

  function log(level: LogLevel, source: LogSource, message: string, details?: unknown): LogEntry | null {
    if (level === 'debug' && !getSettings().captureDebug) return null;
    const normalizedDetails = normalizeLogDetails(details);
    const entry: LogEntry = {
      id: `${context}:${instanceId}:${++sequence}`,
      timestamp: now(),
      level,
      source,
      context,
      message: truncate(String(message), MAX_MESSAGE_LENGTH),
      ...(normalizedDetails === undefined ? {} : { details: normalizedDetails })
    };
    ownEntries.push(entry);
    if (ownEntries.length > MAX_LOG_ENTRIES) ownEntries.splice(0, ownEntries.length - MAX_LOG_ENTRIES);
    mergeCollected([entry]);
    mirror(entry);
    post({ type: 'entry', entry });
    return entry;
  }

  const handleGlobalError = (event: ErrorEvent) => {
    if (BENIGN_GLOBAL_ERROR_MESSAGES.has(event.message)) return;
    log('error', 'system', 'Uncaught error', {
      message: event.message,
      file: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error
    });
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    log('error', 'system', 'Unhandled promise rejection', event.reason);
  };
  const handlePageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) runtimeApi.destroy();
  };

  const runtimeApi: LoggingRuntime = {
    init() {
      if (initialized || destroyed) return;
      initialized = true;
      ensureChannel();
      if (typeof window !== 'undefined') {
        window.addEventListener('error', handleGlobalError);
        window.addEventListener('unhandledrejection', handleUnhandledRejection);
        window.addEventListener('pagehide', handlePageHide);
      }
      log('info', 'system', `${context} context started`, {
        version: appVersion,
        platform: typeof navigator === 'undefined' ? undefined : navigator.platform
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('error', handleGlobalError);
        window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        window.removeEventListener('pagehide', handlePageHide);
      }
      channel?.removeEventListener('message', handleChannelMessage);
      channel?.close();
      channel = null;
      listeners.clear();
    },
    log,
    getEntries: () => (collecting ? collectedEntries : ownEntries).slice(),
    getOwnEntries: () => ownEntries.slice(),
    subscribe(listener) {
      collecting = true;
      if (collectedEntries.length === 0) mergeCollected(ownEntries);
      listeners.add(listener);
      try { listener(collectedEntries.slice()); } catch { /* Subscriber faults stay isolated. */ }
      this.requestHistory();
      return () => listeners.delete(listener);
    },
    requestHistory() {
      collecting = true;
      mergeCollected(ownEntries);
      const requestId = `${instanceId}:history:${++requestSequence}`;
      activeRequestIds.add(requestId);
      if (activeRequestIds.size > 8) activeRequestIds.delete(activeRequestIds.values().next().value as string);
      post({ type: 'history-request', requestId, requesterId: instanceId });
      return requestId;
    },
    clear() {
      ownEntries = [];
      collectedEntries = [];
      rebuildCollectedIds();
      scheduleNotify();
      post({ type: 'clear', requestId: `${instanceId}:clear:${++requestSequence}` });
    }
  };
  return runtimeApi;
}

const runtime = createLoggingRuntime();

export const initLogging = () => runtime.init();
export const log = (level: LogLevel, source: LogSource, message: string, details?: unknown) =>
  runtime.log(level, source, message, details);
export const logError = (source: LogSource, message: string, details?: unknown) =>
  runtime.log('error', source, message, details);
export const logWarning = (source: LogSource, message: string, details?: unknown) =>
  runtime.log('warning', source, message, details);
export const logInfo = (source: LogSource, message: string, details?: unknown) =>
  runtime.log('info', source, message, details);
export const logDebug = (source: LogSource, message: string, details?: unknown) =>
  runtime.log('debug', source, message, details);
export const getLogEntries = () => runtime.getEntries();
export const subscribeLogs = (listener: (entries: LogEntry[]) => void) => runtime.subscribe(listener);
export const clearLogs = () => runtime.clear();
