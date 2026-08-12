import type { ClockPort, IdPort } from '$lib/runtime/ports';
import { ResourceScope, type ScopeDisposalReport } from '$lib/runtime/resource-scope';
import {
  LOG_CHANNEL_NAME,
  LOG_LEVELS,
  LOG_PROTOCOL_VERSION,
  LOG_SOURCES,
  MAX_ACTIVE_LOG_REQUESTS,
  MAX_LOG_ENTRIES,
  MAX_LOG_MESSAGE_IDS,
  MAX_LOG_REQUEST_IDS,
  type LogEntry,
  type LoggingConsole,
  type LoggingSettings,
  type LogLevel,
  type LogSource,
  type LogWriteOptions
} from './contracts';
import { normalizeLogDetails, normalizeLogMessage } from './details';

const MAX_ID_LENGTH = 512;
const MAX_CONTEXT_LENGTH = 128;
const DEFAULT_SETTINGS: LoggingSettings = { captureDebug: false, mirrorToConsole: false };

export interface LogChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

export interface LogChannelFactory {
  create(name: string): LogChannel;
}

interface LogMessageBase {
  readonly protocol: typeof LOG_PROTOCOL_VERSION;
  readonly messageId: string;
  readonly originId: string;
}

type LogChannelMessage =
  | (LogMessageBase & { readonly type: 'entry'; readonly entry: LogEntry })
  | (LogMessageBase & { readonly type: 'history-request'; readonly requestId: string })
  | (LogMessageBase & {
      readonly type: 'history-response';
      readonly requestId: string;
      readonly entries: readonly LogEntry[];
    })
  | (LogMessageBase & { readonly type: 'clear' });

export interface LoggingRuntimeOptions {
  readonly context: string;
  readonly scope: ResourceScope;
  readonly clock: Pick<ClockPort, 'queueMicrotask' | 'wallNow'>;
  readonly ids: IdPort;
  readonly channels?: LogChannelFactory;
  readonly settings: () => LoggingSettings;
  readonly console?: LoggingConsole;
  readonly channelName?: string;
}

export interface LoggingRuntimeDiagnostic {
  readonly initialized: boolean;
  readonly destroyed: boolean;
  readonly channelAvailable: boolean;
  readonly transportFailures: number;
  readonly ownEntries: number;
  readonly collectedEntries: number;
  readonly seenMessageIds: number;
  readonly answeredRequestIds: number;
  readonly activeRequestIds: number;
}

export interface LoggingRuntime {
  readonly context: string;
  readonly instanceId: string;
  init(): void;
  destroy(): Promise<ScopeDisposalReport>;
  createCorrelationId(label?: string): string;
  log(
    level: LogLevel,
    source: LogSource,
    message: unknown,
    details?: unknown,
    options?: LogWriteOptions
  ): LogEntry | null;
  getEntries(): LogEntry[];
  getOwnEntries(): LogEntry[];
  subscribe(listener: (entries: LogEntry[]) => void): () => void;
  requestHistory(): string | null;
  clear(): void;
  diagnostic(): LoggingRuntimeDiagnostic;
}

class BoundedStringSet {
  readonly #values = new Set<string>();

  constructor(private readonly maximum: number) {}

  add(value: string): boolean {
    if (this.#values.has(value)) return false;
    this.#values.add(value);
    while (this.#values.size > this.maximum) {
      const oldest = this.#values.values().next().value;
      if (oldest === undefined) break;
      this.#values.delete(oldest);
    }
    return true;
  }

  has(value: string): boolean {
    return this.#values.has(value);
  }

  delete(value: string): void {
    this.#values.delete(value);
  }

  clear(): void {
    this.#values.clear();
  }

  get size(): number {
    return this.#values.size;
  }
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) return null;
  return value;
}

function isLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LogEntry>;
  return boundedText(entry.id, MAX_ID_LENGTH) !== null
    && boundedText(entry.correlationId, MAX_ID_LENGTH) !== null
    && boundedText(entry.originId, MAX_ID_LENGTH) !== null
    && typeof entry.timestamp === 'number'
    && Number.isFinite(entry.timestamp)
    && boundedText(entry.context, MAX_CONTEXT_LENGTH) !== null
    && typeof entry.message === 'string'
    && entry.message.length <= 4096
    && (entry.details === undefined || (typeof entry.details === 'string' && entry.details.length <= 32768))
    && LOG_LEVELS.includes(entry.level as LogLevel)
    && LOG_SOURCES.includes(entry.source as LogSource);
}

function compareEntries(left: LogEntry, right: LogEntry): number {
  return left.timestamp - right.timestamp || left.id.localeCompare(right.id);
}

function capNewest(entries: LogEntry[]): LogEntry[] {
  if (entries.length <= MAX_LOG_ENTRIES) return entries;
  entries.sort(compareEntries);
  return entries.slice(entries.length - MAX_LOG_ENTRIES);
}

function readStringProperty(value: Record<string, unknown>, key: string): string | null {
  try {
    return boundedText(value[key], MAX_ID_LENGTH);
  } catch {
    return null;
  }
}

function readMessageBase(value: unknown): (Record<string, unknown> & LogMessageBase) | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  try {
    if (candidate.protocol !== LOG_PROTOCOL_VERSION) return null;
  } catch {
    return null;
  }
  const messageId = readStringProperty(candidate, 'messageId');
  const originId = readStringProperty(candidate, 'originId');
  if (!messageId || !originId) return null;
  return candidate as Record<string, unknown> & LogMessageBase;
}

export function createLoggingRuntime(options: LoggingRuntimeOptions): LoggingRuntime {
  const context = normalizeLogMessage(options.context).slice(0, MAX_CONTEXT_LENGTH) || 'window';
  let fallbackId = 0;
  const nextId = (label: string): string => {
    let generated: string;
    try {
      generated = options.ids.create();
    } catch {
      generated = `fallback-${++fallbackId}`;
    }
    return `${context}:${label}:${generated}`.slice(0, MAX_ID_LENGTH);
  };
  const instanceId = nextId('context');
  const channelName = options.channelName ?? LOG_CHANNEL_NAME;

  let sequence = 0;
  let initialized = false;
  let destroyed = false;
  let collecting = false;
  let notificationPending = false;
  let channel: LogChannel | null = null;
  let transportFailures = 0;
  let ownEntries: LogEntry[] = [];
  let collectedEntries: LogEntry[] = [];
  const collectedIds = new Set<string>();
  const listeners = new Set<(entries: LogEntry[]) => void>();
  const seenMessageIds = new BoundedStringSet(MAX_LOG_MESSAGE_IDS);
  const answeredRequestIds = new BoundedStringSet(MAX_LOG_REQUEST_IDS);
  const activeRequestIds = new BoundedStringSet(MAX_ACTIVE_LOG_REQUESTS);

  function readSettings(): LoggingSettings {
    try {
      const settings = options.settings();
      return {
        captureDebug: settings.captureDebug === true,
        mirrorToConsole: settings.mirrorToConsole === true
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  function makeMessage<T extends { readonly type: LogChannelMessage['type'] }>(message: T): T & LogMessageBase {
    return {
      ...message,
      protocol: LOG_PROTOCOL_VERSION,
      messageId: nextId('message'),
      originId: instanceId
    };
  }

  function post(message: LogChannelMessage): void {
    if (!channel || destroyed) return;
    try {
      channel.postMessage(message);
    } catch {
      transportFailures += 1;
    }
  }

  function notifyNow(): void {
    notificationPending = false;
    if (destroyed || listeners.size === 0) return;
    const snapshot = collectedEntries.slice();
    for (const listener of [...listeners]) {
      try { listener(snapshot); } catch { /* Subscriber failures stay isolated. */ }
    }
  }

  function scheduleNotify(): void {
    if (notificationPending || listeners.size === 0 || destroyed) return;
    notificationPending = true;
    try {
      options.clock.queueMicrotask(notifyNow);
    } catch {
      notifyNow();
    }
  }

  function rebuildCollectedIds(): void {
    collectedIds.clear();
    for (const entry of collectedEntries) collectedIds.add(entry.id);
  }

  function mergeCollected(entries: readonly LogEntry[]): void {
    if (!collecting || destroyed || entries.length === 0) return;
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

  function handleChannelMessage(event: MessageEvent<unknown>): void {
    if (destroyed) return;
    let message: (Record<string, unknown> & LogMessageBase) | null;
    try {
      message = readMessageBase(event.data);
    } catch {
      return;
    }
    if (!message || message.originId === instanceId || !seenMessageIds.add(message.messageId)) return;

    let type: unknown;
    try { type = message.type; } catch { return; }
    if (type === 'entry') {
      let entry: unknown;
      try { entry = message.entry; } catch { return; }
      if (isLogEntry(entry) && entry.originId === message.originId) mergeCollected([entry]);
      return;
    }

    if (type === 'history-request') {
      const requestId = readStringProperty(message, 'requestId');
      if (!requestId || !answeredRequestIds.add(requestId)) return;
      post(makeMessage({
        type: 'history-response',
        requestId,
        entries: ownEntries.slice()
      }));
      return;
    }

    if (type === 'history-response') {
      const requestId = readStringProperty(message, 'requestId');
      if (!requestId || !activeRequestIds.has(requestId)) return;
      let entries: unknown;
      try { entries = message.entries; } catch { return; }
      if (!Array.isArray(entries)) return;
      mergeCollected(entries.slice(-MAX_LOG_ENTRIES).filter(isLogEntry));
      return;
    }

    if (type === 'clear') {
      ownEntries = [];
      collectedEntries = [];
      rebuildCollectedIds();
      activeRequestIds.clear();
      scheduleNotify();
    }
  }

  function openChannel(): void {
    if (!options.channels) return;
    let candidate: LogChannel;
    try {
      candidate = options.channels.create(channelName);
    } catch {
      transportFailures += 1;
      return;
    }

    let channelRegistration;
    try {
      channelRegistration = options.scope.own(
        { kind: 'broadcast-channel', label: `${context} logging channel` },
        candidate,
        (owned) => owned.close()
      ).registration;
    } catch {
      transportFailures += 1;
      try { candidate.close(); } catch { transportFailures += 1; }
      return;
    }

    try {
      candidate.addEventListener('message', handleChannelMessage);
      options.scope.register(
        { kind: 'event-listener', label: `${context} logging messages` },
        () => candidate.removeEventListener('message', handleChannelMessage)
      );
      channel = candidate;
    } catch {
      transportFailures += 1;
      try { candidate.removeEventListener('message', handleChannelMessage); } catch { transportFailures += 1; }
      void channelRegistration.release();
    }
  }

  function mirror(entry: LogEntry): void {
    if (!options.console || !readSettings().mirrorToConsole) return;
    const prefix = `[izci:${entry.level}] [${entry.source}] [${entry.context}] [${entry.correlationId}]`;
    const values = entry.details ? [prefix, entry.message, entry.details] : [prefix, entry.message];
    try {
      if (entry.level === 'error') options.console.error(...values);
      else if (entry.level === 'warning') options.console.warn(...values);
      else if (entry.level === 'debug') options.console.debug(...values);
      else options.console.info(...values);
    } catch {
      // Console adapters and test doubles cannot compromise local logging.
    }
  }

  const runtime: LoggingRuntime = {
    context,
    instanceId,
    init() {
      if (initialized || destroyed) return;
      initialized = true;
      openChannel();
    },
    destroy() {
      if (!destroyed) {
        destroyed = true;
        channel = null;
        listeners.clear();
        activeRequestIds.clear();
        answeredRequestIds.clear();
        seenMessageIds.clear();
      }
      return options.scope.dispose();
    },
    createCorrelationId(label = 'correlation') {
      return nextId(normalizeLogMessage(label).slice(0, 64) || 'correlation');
    },
    log(level, source, message, details, writeOptions) {
      if (!initialized || destroyed) return null;
      if (level === 'debug' && !readSettings().captureDebug) return null;
      let requestedCorrelationId: unknown;
      try { requestedCorrelationId = writeOptions?.correlationId; } catch { /* Generate a safe ID below. */ }
      const correlationId = boundedText(requestedCorrelationId, MAX_ID_LENGTH) ?? runtime.createCorrelationId();
      const normalizedDetails = normalizeLogDetails(details);
      let timestamp = 0;
      try {
        const candidate = options.clock.wallNow();
        if (Number.isFinite(candidate)) timestamp = candidate;
      } catch { /* A broken clock cannot prevent the diagnostic from being recorded. */ }
      const entry: LogEntry = {
        id: `${instanceId}:entry:${++sequence}`.slice(0, MAX_ID_LENGTH),
        correlationId,
        originId: instanceId,
        timestamp,
        level,
        source,
        context,
        message: normalizeLogMessage(message),
        ...(normalizedDetails === undefined ? {} : { details: normalizedDetails })
      };
      ownEntries.push(entry);
      if (ownEntries.length > MAX_LOG_ENTRIES) ownEntries.splice(0, ownEntries.length - MAX_LOG_ENTRIES);
      mergeCollected([entry]);
      mirror(entry);
      post(makeMessage({ type: 'entry', entry }));
      return entry;
    },
    getEntries: () => (collecting ? collectedEntries : ownEntries).slice(),
    getOwnEntries: () => ownEntries.slice(),
    subscribe(listener) {
      if (destroyed) {
        try { listener([]); } catch { /* Subscriber failures stay isolated. */ }
        return () => undefined;
      }
      collecting = true;
      mergeCollected(ownEntries);
      listeners.add(listener);
      try { listener(collectedEntries.slice()); } catch { /* Subscriber failures stay isolated. */ }
      runtime.requestHistory();
      return () => { listeners.delete(listener); };
    },
    requestHistory() {
      if (!initialized || destroyed) return null;
      collecting = true;
      mergeCollected(ownEntries);
      const requestId = nextId('history');
      activeRequestIds.add(requestId);
      post(makeMessage({ type: 'history-request', requestId }));
      return requestId;
    },
    clear() {
      if (!initialized || destroyed) return;
      ownEntries = [];
      collectedEntries = [];
      rebuildCollectedIds();
      activeRequestIds.clear();
      scheduleNotify();
      post(makeMessage({ type: 'clear' }));
    },
    diagnostic: () => ({
      initialized,
      destroyed,
      channelAvailable: channel !== null,
      transportFailures,
      ownEntries: ownEntries.length,
      collectedEntries: collectedEntries.length,
      seenMessageIds: seenMessageIds.size,
      answeredRequestIds: answeredRequestIds.size,
      activeRequestIds: activeRequestIds.size
    })
  };

  return runtime;
}
