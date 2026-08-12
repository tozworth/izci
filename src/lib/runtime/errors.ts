export type DomainErrorCategory =
  | 'cancellation'
  | 'unavailable'
  | 'permission'
  | 'quota'
  | 'blocked'
  | 'corruption'
  | 'stale'
  | 'conflict'
  | 'timeout'
  | 'io'
  | 'internal';

export interface SafeErrorCause {
  readonly name: string;
  readonly message: string;
  readonly code?: string | number;
}

export interface DomainErrorOptions {
  readonly category: DomainErrorCategory;
  readonly code: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
  readonly message?: string;
}

function causeCode(value: object): string | number | undefined {
  if (!('code' in value)) return undefined;
  const code = value.code;
  return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}

export function safeErrorCause(cause: unknown): SafeErrorCause | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (typeof cause === 'object') {
    const name = 'name' in cause && typeof cause.name === 'string' ? cause.name : 'Error';
    const message = 'message' in cause && typeof cause.message === 'string'
      ? cause.message
      : 'An error occurred';
    return { name, message, ...(causeCode(cause) === undefined ? {} : { code: causeCode(cause) }) };
  }
  return { name: 'Error', message: String(cause) };
}

export class DomainError extends Error {
  readonly category: DomainErrorCategory;
  readonly code: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly safeCause?: SafeErrorCause;

  constructor(options: DomainErrorOptions) {
    const safeCause = safeErrorCause(options.cause);
    super(options.message ?? safeCause?.message ?? options.code);
    this.name = 'DomainError';
    this.category = options.category;
    this.code = options.code;
    this.operation = options.operation;
    this.retryable = options.retryable;
    this.safeCause = safeCause;
  }
}

export interface ErrorClassification {
  readonly category: DomainErrorCategory;
  readonly retryable: boolean;
}

export function classifyError(cause: unknown): ErrorClassification {
  if (cause instanceof DomainError) {
    return { category: cause.category, retryable: cause.retryable };
  }

  const safeCause = safeErrorCause(cause);
  const name = safeCause?.name ?? '';
  const message = safeCause?.message.toLowerCase() ?? '';

  if (name === 'AbortError') return { category: 'cancellation', retryable: false };
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { category: 'permission', retryable: true };
  }
  if (name === 'QuotaExceededError') return { category: 'quota', retryable: true };
  if (name === 'NotSupportedError' || name === 'ReferenceError') {
    return { category: 'unavailable', retryable: false };
  }
  if (name === 'TimeoutError') return { category: 'timeout', retryable: true };
  if (name === 'InvalidStateError' || name === 'VersionError') {
    return { category: 'blocked', retryable: true };
  }
  if (name === 'DataError' || name === 'DataCloneError' || message.includes('corrupt')) {
    return { category: 'corruption', retryable: false };
  }
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'NetworkError') {
    return { category: 'io', retryable: true };
  }
  return { category: 'internal', retryable: false };
}

export function toDomainError(
  cause: unknown,
  operation: string,
  code = 'runtime.operation-failed'
): DomainError {
  if (cause instanceof DomainError) return cause;
  const classification = classifyError(cause);
  return new DomainError({ ...classification, code, operation, cause });
}
