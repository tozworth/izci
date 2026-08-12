const MAX_MESSAGE_LENGTH = 4096;
const MAX_DETAILS_LENGTH = 32768;
const MAX_DETAIL_DEPTH = 8;
const MAX_DETAIL_NODES = 1024;
const MAX_OBJECT_KEYS = 64;
const MAX_ARRAY_ITEMS = 128;

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function safeString(value: unknown, fallback: string): string {
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

export function normalizeLogMessage(message: unknown): string {
  return truncate(safeString(message, '[Unprintable message]'), MAX_MESSAGE_LENGTH);
}

function errorSnapshot(value: Error): Record<string, unknown> {
  const result: Record<string, unknown> = { name: 'Error', message: '[Unreadable error]' };
  try { result.name = safeString(value.name, 'Error'); } catch { /* Keep the safe default. */ }
  try { result.message = safeString(value.message, '[Unreadable error]'); } catch { /* Keep the safe default. */ }
  try {
    if (value.stack !== undefined) result.stack = safeString(value.stack, '[Unreadable stack]');
  } catch { /* A hostile stack accessor is omitted. */ }
  return result;
}

function sanitizeDetails(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let visited = 0;

  const visit = (current: unknown, depth: number): unknown => {
    visited += 1;
    if (visited > MAX_DETAIL_NODES) return '[Detail node limit reached]';
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'string') return truncate(current, MAX_DETAILS_LENGTH);
    if (typeof current === 'number') return Number.isFinite(current) ? current : safeString(current, '[Number]');
    if (typeof current === 'bigint') return `${current}n`;
    if (typeof current === 'undefined') return '[Undefined]';
    if (typeof current === 'symbol') return safeString(current, '[Symbol]');
    if (typeof current === 'function') {
      let name = '';
      try { name = safeString(current.name, ''); } catch { /* Omit a hostile name. */ }
      return name ? `[Function ${name}]` : '[Function]';
    }
    if (typeof current !== 'object') return safeString(current, '[Unserializable value]');

    if (seen.has(current)) return '[Circular]';
    if (depth >= MAX_DETAIL_DEPTH) return '[Detail depth limit reached]';
    seen.add(current);

    try {
      if (current instanceof Error) return visit(errorSnapshot(current), depth + 1);
    } catch { /* Treat proxies with hostile prototype traps as ordinary objects. */ }

    let isArray = false;
    try { isArray = Array.isArray(current); } catch { return '[Uninspectable object]'; }
    if (isArray) {
      let sourceLength = 0;
      try { sourceLength = (current as unknown[]).length; } catch { return '[Uninspectable array]'; }
      const length = Math.min(sourceLength, MAX_ARRAY_ITEMS);
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        try {
          result.push(visit((current as unknown[])[index], depth + 1));
        } catch {
          result.push('[Thrown array accessor]');
        }
      }
      if (sourceLength > MAX_ARRAY_ITEMS) result.push(`[${sourceLength - MAX_ARRAY_ITEMS} more items]`);
      return result;
    }

    let keys: string[];
    try {
      keys = Object.keys(current);
    } catch {
      return '[Uninspectable object]';
    }
    const result: Record<string, unknown> = {};
    for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
      try {
        result[key] = visit((current as Record<string, unknown>)[key], depth + 1);
      } catch {
        result[key] = '[Thrown property accessor]';
      }
    }
    if (keys.length > MAX_OBJECT_KEYS) result['[truncated properties]'] = keys.length - MAX_OBJECT_KEYS;
    return result;
  };

  return visit(value, 0);
}

export function normalizeLogDetails(details: unknown): string | undefined {
  if (details === undefined || details === null) return undefined;
  if (typeof details === 'string') return truncate(details, MAX_DETAILS_LENGTH);
  try {
    return truncate(JSON.stringify(sanitizeDetails(details)), MAX_DETAILS_LENGTH);
  } catch {
    return truncate(safeString(details, '[Unserializable details]'), MAX_DETAILS_LENGTH);
  }
}
