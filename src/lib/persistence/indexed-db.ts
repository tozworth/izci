import { safeErrorCause, type SafeErrorCause } from '$lib/runtime/errors';
import type { ResourceRegistration } from '$lib/runtime/resource-scope';
import { ResourceScope } from '$lib/runtime/resource-scope';

export type PersistenceErrorCategory =
  | 'unavailable'
  | 'blocked'
  | 'versionchange'
  | 'abort'
  | 'quota'
  | 'corrupt'
  | 'closed'
  | 'io';

export type PersistenceErrorCode =
  | 'persistence.indexed-db-unavailable'
  | 'persistence.open-blocked'
  | 'persistence.versionchange'
  | 'persistence.transaction-aborted'
  | 'persistence.quota-exceeded'
  | 'persistence.schema-corrupt'
  | 'persistence.connection-closed'
  | 'persistence.io-failed';

export interface PersistenceErrorOptions {
  readonly category: PersistenceErrorCategory;
  readonly code: PersistenceErrorCode;
  readonly operation: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
  readonly message?: string;
}

export class PersistenceError extends Error {
  readonly category: PersistenceErrorCategory;
  readonly code: PersistenceErrorCode;
  readonly operation: string;
  readonly retryable: boolean;
  readonly safeCause?: SafeErrorCause;

  constructor(options: PersistenceErrorOptions) {
    const safeCause = safeErrorCause(options.cause);
    super(options.message ?? safeCause?.message ?? options.code);
    this.name = 'PersistenceError';
    this.category = options.category;
    this.code = options.code;
    this.operation = options.operation;
    this.retryable = options.retryable;
    this.safeCause = safeCause;
  }
}

declare const indexKeyType: unique symbol;
declare const storeKeyType: unique symbol;
declare const storeValueType: unique symbol;

export interface DatabaseIndexSpec<TKey extends IDBValidKey = IDBValidKey> {
  readonly keyPath: string | readonly string[];
  readonly unique?: boolean;
  readonly multiEntry?: boolean;
  readonly [indexKeyType]?: TKey;
}

export type DatabaseIndexMap = Readonly<Record<string, DatabaseIndexSpec>>;

export interface DatabaseStoreSpec<
  TValue = unknown,
  TKey extends IDBValidKey = IDBValidKey,
  TIndexes extends DatabaseIndexMap = DatabaseIndexMap
> {
  readonly keyPath?: string | readonly string[] | null;
  readonly autoIncrement?: boolean;
  readonly indexes?: TIndexes;
  readonly [storeValueType]?: TValue;
  readonly [storeKeyType]?: TKey;
}

export type DatabaseStoreMap = Readonly<Record<string, DatabaseStoreSpec>>;

export interface DatabaseSpec<TStores extends DatabaseStoreMap = DatabaseStoreMap> {
  readonly name: string;
  readonly version: number;
  readonly stores: TStores;
}

export interface IndexedDbFactoryPort {
  open(name: string, version?: number): IDBOpenDBRequest;
}

export function defineIndex<TKey extends IDBValidKey>(
  descriptor: Omit<DatabaseIndexSpec<TKey>, typeof indexKeyType>
): DatabaseIndexSpec<TKey> {
  return descriptor;
}

export function defineStore<TValue, TKey extends IDBValidKey>() {
  return <const TIndexes extends DatabaseIndexMap = Record<never, never>>(
    descriptor: Omit<DatabaseStoreSpec<TValue, TKey, TIndexes>, typeof storeKeyType | typeof storeValueType>
  ): DatabaseStoreSpec<TValue, TKey, TIndexes> => descriptor;
}

export function defineDatabase<const TStores extends DatabaseStoreMap>(
  descriptor: DatabaseSpec<TStores>
): DatabaseSpec<TStores> {
  return descriptor;
}

type StoreName<TSpec extends DatabaseSpec> = Extract<keyof TSpec['stores'], string>;
type StoreDefinition<TSpec extends DatabaseSpec, TName extends StoreName<TSpec>> = TSpec['stores'][TName];
type StoreValue<TStore> = TStore extends DatabaseStoreSpec<infer TValue, IDBValidKey, DatabaseIndexMap>
  ? TValue
  : never;
type StoreKey<TStore> = TStore extends DatabaseStoreSpec<unknown, infer TKey, DatabaseIndexMap>
  ? TKey
  : never;
type StoreIndexes<TStore> = TStore extends DatabaseStoreSpec<unknown, IDBValidKey, infer TIndexes>
  ? TIndexes
  : never;
type IndexName<TStore> = Extract<keyof StoreIndexes<TStore>, string>;
type IndexKey<TIndex> = TIndex extends DatabaseIndexSpec<infer TKey> ? TKey : never;

export interface DatabaseConnectionState {
  readonly status: 'open' | 'closed';
  readonly reason?: DatabaseCloseReason;
  readonly oldVersion?: number;
  readonly newVersion?: number | null;
  readonly error?: PersistenceError;
}

export type DatabaseCloseReason = 'manual' | 'scope' | 'versionchange';

export interface DatabaseConnection<TSpec extends DatabaseSpec = DatabaseSpec> {
  readonly spec: TSpec;
  readonly closed: Promise<DatabaseConnectionState>;
  state(): DatabaseConnectionState;
  close(): Promise<void>;
}

interface ConnectionInternal<TSpec extends DatabaseSpec> {
  readonly database: IDBDatabase;
  readonly registration: ResourceRegistration;
  readonly state: () => DatabaseConnectionState;
  readonly requestClose: (
    reason: DatabaseCloseReason,
    version?: Pick<IDBVersionChangeEvent, 'oldVersion' | 'newVersion'>
  ) => Promise<void>;
  readonly spec: TSpec;
}

const connectionInternals = new WeakMap<DatabaseConnection, ConnectionInternal<DatabaseSpec>>();

export interface TransactionIndex<TValue, TPrimaryKey extends IDBValidKey, TIndexKey extends IDBValidKey> {
  get(query: TIndexKey | IDBKeyRange): Promise<TValue | undefined>;
  getKey(query: TIndexKey | IDBKeyRange): Promise<TPrimaryKey | undefined>;
  getAll(query?: TIndexKey | IDBKeyRange | null, count?: number): Promise<TValue[]>;
  getAllKeys(query?: TIndexKey | IDBKeyRange | null, count?: number): Promise<TPrimaryKey[]>;
  count(query?: TIndexKey | IDBKeyRange | null): Promise<number>;
}

export interface TransactionStore<TStore extends DatabaseStoreSpec> {
  get(query: StoreKey<TStore> | IDBKeyRange): Promise<StoreValue<TStore> | undefined>;
  getAll(query?: StoreKey<TStore> | IDBKeyRange | null, count?: number): Promise<Array<StoreValue<TStore>>>;
  getAllKeys(query?: StoreKey<TStore> | IDBKeyRange | null, count?: number): Promise<Array<StoreKey<TStore>>>;
  put(value: StoreValue<TStore>, key?: StoreKey<TStore>): Promise<StoreKey<TStore>>;
  add(value: StoreValue<TStore>, key?: StoreKey<TStore>): Promise<StoreKey<TStore>>;
  delete(query: StoreKey<TStore> | IDBKeyRange): Promise<void>;
  clear(): Promise<void>;
  count(query?: StoreKey<TStore> | IDBKeyRange | null): Promise<number>;
  index<TName extends IndexName<TStore>>(
    name: TName
  ): TransactionIndex<StoreValue<TStore>, StoreKey<TStore>, IndexKey<StoreIndexes<TStore>[TName]>>;
}

export interface TypedTransaction<
  TSpec extends DatabaseSpec,
  TNames extends StoreName<TSpec>
> {
  readonly mode: IDBTransactionMode;
  store<TName extends TNames>(name: TName): TransactionStore<StoreDefinition<TSpec, TName>>;
}

export interface TransactionOptions<
  TSpec extends DatabaseSpec,
  TNames extends readonly StoreName<TSpec>[]
> {
  readonly stores: TNames;
  readonly mode: IDBTransactionMode;
  readonly operation: string;
  readonly durability?: IDBTransactionDurability;
}

interface RequestedClose {
  readonly reason: DatabaseCloseReason;
  readonly oldVersion?: number;
  readonly newVersion?: number | null;
}

function namedCause(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function persistenceError(
  category: PersistenceErrorCategory,
  code: PersistenceErrorCode,
  operation: string,
  cause?: unknown,
  message?: string
): PersistenceError {
  return new PersistenceError({
    category,
    code,
    operation,
    retryable: category === 'blocked' || category === 'versionchange' || category === 'quota' || category === 'io',
    cause,
    message
  });
}

function causeName(cause: unknown): string {
  return typeof cause === 'object' && cause !== null && 'name' in cause && typeof cause.name === 'string'
    ? cause.name
    : '';
}

function classifyPersistenceError(cause: unknown, operation: string): PersistenceError {
  if (cause instanceof PersistenceError) return cause;
  switch (causeName(cause)) {
    case 'AbortError':
      return persistenceError('abort', 'persistence.transaction-aborted', operation, cause);
    case 'QuotaExceededError':
      return persistenceError('quota', 'persistence.quota-exceeded', operation, cause);
    case 'VersionError':
      return persistenceError('versionchange', 'persistence.versionchange', operation, cause);
    case 'InvalidStateError':
      return persistenceError('closed', 'persistence.connection-closed', operation, cause);
    case 'NotSupportedError':
    case 'SecurityError':
    case 'ReferenceError':
      return persistenceError('unavailable', 'persistence.indexed-db-unavailable', operation, cause);
    case 'ConstraintError':
    case 'DataCloneError':
    case 'DataError':
      return persistenceError('corrupt', 'persistence.schema-corrupt', operation, cause);
    default:
      return persistenceError('io', 'persistence.io-failed', operation, cause);
  }
}

function names(list: DOMStringList): string[] {
  const result: string[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const value = list.item(index);
    if (value !== null) result.push(value);
  }
  return result;
}

function sameNames(actual: DOMStringList, expected: readonly string[]): boolean {
  const actualNames = names(actual).sort();
  const expectedNames = [...expected].sort();
  return actualNames.length === expectedNames.length
    && actualNames.every((value, index) => value === expectedNames[index]);
}

function sameKeyPath(actual: string | string[] | null, expected: string | readonly string[] | null | undefined): boolean {
  const normalizedExpected = expected ?? null;
  if (Array.isArray(actual) || Array.isArray(normalizedExpected)) {
    return Array.isArray(actual)
      && Array.isArray(normalizedExpected)
      && actual.length === normalizedExpected.length
      && actual.every((value, index) => value === normalizedExpected[index]);
  }
  return actual === normalizedExpected;
}

function validateSpec(spec: DatabaseSpec): void {
  const operation = `validate schema ${spec.name}`;
  if (spec.name.trim().length === 0 || !Number.isInteger(spec.version) || spec.version < 1) {
    throw persistenceError('corrupt', 'persistence.schema-corrupt', operation, undefined, 'Invalid database identity or version');
  }
  const storeEntries = Object.entries(spec.stores);
  if (storeEntries.length === 0) {
    throw persistenceError('corrupt', 'persistence.schema-corrupt', operation, undefined, 'A database must declare at least one store');
  }
  const invalidName = storeEntries.some(([storeName, store]) => storeName.length === 0
    || Object.keys(store.indexes ?? {}).some((indexName) => indexName.length === 0));
  if (invalidName) {
    throw persistenceError('corrupt', 'persistence.schema-corrupt', operation, undefined, 'Store and index names must not be empty');
  }
}

function applyCurrentSchema(database: IDBDatabase, spec: DatabaseSpec): void {
  for (const storeName of names(database.objectStoreNames)) database.deleteObjectStore(storeName);
  for (const [storeName, storeSpec] of Object.entries(spec.stores)) {
    const keyPath = storeSpec.keyPath === undefined ? null : storeSpec.keyPath;
    const store = database.createObjectStore(storeName, {
      keyPath: keyPath as string | string[] | null,
      autoIncrement: storeSpec.autoIncrement ?? false
    });
    for (const [indexName, indexSpec] of Object.entries(storeSpec.indexes ?? {})) {
      store.createIndex(indexName, indexSpec.keyPath as string | string[], {
        unique: indexSpec.unique ?? false,
        multiEntry: indexSpec.multiEntry ?? false
      });
    }
  }
}

function validateOpenSchema(database: IDBDatabase, spec: DatabaseSpec): void {
  const storeNames = Object.keys(spec.stores);
  if (!sameNames(database.objectStoreNames, storeNames)) {
    throw persistenceError(
      'corrupt',
      'persistence.schema-corrupt',
      `validate open schema ${spec.name}`,
      undefined,
      'The database stores do not match the current schema'
    );
  }
  let transaction: IDBTransaction;
  try {
    transaction = database.transaction(storeNames, 'readonly');
  } catch (cause) {
    throw persistenceError('corrupt', 'persistence.schema-corrupt', `validate open schema ${spec.name}`, cause);
  }
  for (const [storeName, storeSpec] of Object.entries(spec.stores)) {
    const store = transaction.objectStore(storeName);
    if (!sameKeyPath(store.keyPath, storeSpec.keyPath)
      || store.autoIncrement !== (storeSpec.autoIncrement ?? false)
      || !sameNames(store.indexNames, Object.keys(storeSpec.indexes ?? {}))) {
      throw persistenceError(
        'corrupt',
        'persistence.schema-corrupt',
        `validate store ${spec.name}/${storeName}`,
        undefined,
        'The object store does not match the current schema'
      );
    }
    for (const [indexName, indexSpec] of Object.entries(storeSpec.indexes ?? {})) {
      const index = store.index(indexName);
      if (!sameKeyPath(index.keyPath, indexSpec.keyPath)
        || index.unique !== (indexSpec.unique ?? false)
        || index.multiEntry !== (indexSpec.multiEntry ?? false)) {
        throw persistenceError(
          'corrupt',
          'persistence.schema-corrupt',
          `validate index ${spec.name}/${storeName}/${indexName}`,
          undefined,
          'The index does not match the current schema'
        );
      }
    }
  }
}

function createConnection<TSpec extends DatabaseSpec>(
  database: IDBDatabase,
  spec: TSpec,
  scope: ResourceScope
): DatabaseConnection<TSpec> {
  let requestedClose: RequestedClose | undefined;
  let closedState: DatabaseConnectionState | undefined;
  let resolveClosed!: (state: DatabaseConnectionState) => void;
  const closed = new Promise<DatabaseConnectionState>((resolve) => { resolveClosed = resolve; });
  let registration!: ResourceRegistration;

  const releaseDatabase = (): void => {
    if (closedState) return;
    const close = requestedClose ?? { reason: 'scope' as const };
    let error: PersistenceError | undefined;
    database.onversionchange = null;
    try {
      database.close();
    } catch (cause) {
      error = classifyPersistenceError(cause, `close database ${spec.name}`);
    }
    closedState = {
      status: 'closed',
      reason: close.reason,
      ...(close.oldVersion === undefined ? {} : { oldVersion: close.oldVersion }),
      ...(close.newVersion === undefined ? {} : { newVersion: close.newVersion }),
      ...(error === undefined ? {} : { error })
    };
    resolveClosed(closedState);
    if (error) throw error;
  };

  try {
    registration = scope.register(
      { kind: 'database-connection', label: `indexed-db:${spec.name}` },
      releaseDatabase
    );
  } catch (cause) {
    database.onversionchange = null;
    try { database.close(); } catch { /* The acquisition failure remains authoritative. */ }
    throw persistenceError(
      'closed',
      'persistence.connection-closed',
      `register database ${spec.name}`,
      cause,
      'The owning resource scope is no longer active'
    );
  }

  const requestClose = async (
    reason: DatabaseCloseReason,
    version?: Pick<IDBVersionChangeEvent, 'oldVersion' | 'newVersion'>
  ): Promise<void> => {
    if (!requestedClose && !closedState) {
      requestedClose = {
        reason,
        ...(version === undefined ? {} : { oldVersion: version.oldVersion, newVersion: version.newVersion })
      };
    }
    const result = await registration.release();
    if (!result.ok) {
      throw classifyPersistenceError(result.error, `close database ${spec.name}`);
    }
  };

  const connection: DatabaseConnection<TSpec> = {
    spec,
    closed,
    state: () => closedState ?? { status: 'open' },
    close: () => requestClose('manual')
  };
  connectionInternals.set(connection, { database, registration, state: connection.state, requestClose, spec });
  database.onversionchange = (event) => {
    void requestClose('versionchange', event).catch(() => undefined);
  };
  return connection;
}

export function openDatabase<TSpec extends DatabaseSpec>(
  spec: TSpec,
  scope: ResourceScope | null | undefined,
  factory: IndexedDbFactoryPort | null | undefined
): Promise<DatabaseConnection<TSpec>> {
  const operation = `open database ${spec.name}`;
  try {
    validateSpec(spec);
  } catch (cause) {
    return Promise.reject(classifyPersistenceError(cause, operation));
  }
  if (!factory || !scope) {
    return Promise.reject(persistenceError(
      'unavailable',
      'persistence.indexed-db-unavailable',
      operation,
      undefined,
      'IndexedDB is unavailable'
    ));
  }

  let request: IDBOpenDBRequest;
  try {
    request = factory.open(spec.name, spec.version);
  } catch (cause) {
    return Promise.reject(classifyPersistenceError(cause, operation));
  }

  return new Promise<DatabaseConnection<TSpec>>((resolve, reject) => {
    let settled = false;
    let upgradeFailure: PersistenceError | undefined;
    const rejectOnce = (error: PersistenceError): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.onblocked = () => {
      rejectOnce(persistenceError(
        'blocked',
        'persistence.open-blocked',
        operation,
        undefined,
        `Opening IndexedDB database "${spec.name}" was blocked by another connection`
      ));
    };
    request.onupgradeneeded = () => {
      if (settled) {
        try { request.transaction?.abort(); } catch { /* A settled open has no remaining work to preserve. */ }
        return;
      }
      try {
        applyCurrentSchema(request.result, spec);
      } catch (cause) {
        upgradeFailure = classifyPersistenceError(cause, `apply current schema ${spec.name}`);
        if (upgradeFailure.category !== 'corrupt') {
          upgradeFailure = persistenceError(
            'corrupt',
            'persistence.schema-corrupt',
            `apply current schema ${spec.name}`,
            upgradeFailure
          );
        }
        try { request.transaction?.abort(); } catch { /* The schema failure remains authoritative. */ }
      }
    };
    request.onerror = () => {
      rejectOnce(upgradeFailure ?? classifyPersistenceError(request.error, operation));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled || upgradeFailure) {
        database.close();
        if (upgradeFailure) rejectOnce(upgradeFailure);
        return;
      }
      try {
        validateOpenSchema(database, spec);
        const connection = createConnection(database, spec, scope);
        settled = true;
        resolve(connection);
      } catch (cause) {
        database.close();
        rejectOnce(classifyPersistenceError(cause, operation));
      }
    };
  });
}

function requestResult<TResult>(request: IDBRequest<TResult>, operation: string): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(classifyPersistenceError(request.error, operation));
  });
}

function queryArgument(query: IDBValidKey | IDBKeyRange | null | undefined): IDBValidKey | IDBKeyRange | null {
  return query === undefined ? null : query;
}

function countQueryArgument(query: IDBValidKey | IDBKeyRange | null | undefined): IDBValidKey | IDBKeyRange | undefined {
  return query === null ? undefined : query;
}

function createTransactionIndex<TValue, TPrimaryKey extends IDBValidKey, TIndexKey extends IDBValidKey>(
  index: IDBIndex,
  operation: string
): TransactionIndex<TValue, TPrimaryKey, TIndexKey> {
  return {
    get: (query) => requestResult(index.get(query), `${operation}: get`),
    getKey: (query) => requestResult(index.getKey(query), `${operation}: get key`) as Promise<TPrimaryKey | undefined>,
    getAll: (query, count) => requestResult(index.getAll(queryArgument(query), count), `${operation}: get all`),
    getAllKeys: (query, count) => requestResult(index.getAllKeys(queryArgument(query), count), `${operation}: get all keys`) as Promise<TPrimaryKey[]>,
    count: (query) => requestResult(index.count(countQueryArgument(query)), `${operation}: count`)
  };
}

function createTransactionStore<TStore extends DatabaseStoreSpec>(
  store: IDBObjectStore,
  operation: string
): TransactionStore<TStore> {
  return {
    get: (query) => requestResult(store.get(query), `${operation}: get`),
    getAll: (query, count) => requestResult(store.getAll(queryArgument(query), count), `${operation}: get all`),
    getAllKeys: (query, count) => requestResult(store.getAllKeys(queryArgument(query), count), `${operation}: get all keys`) as Promise<Array<StoreKey<TStore>>>,
    put: (value, key) => requestResult(
      key === undefined ? store.put(value) : store.put(value, key),
      `${operation}: put`
    ) as Promise<StoreKey<TStore>>,
    add: (value, key) => requestResult(
      key === undefined ? store.add(value) : store.add(value, key),
      `${operation}: add`
    ) as Promise<StoreKey<TStore>>,
    delete: (query) => requestResult(store.delete(query), `${operation}: delete`),
    clear: () => requestResult(store.clear(), `${operation}: clear`),
    count: (query) => requestResult(store.count(countQueryArgument(query)), `${operation}: count`),
    index: (name) => createTransactionIndex(store.index(name), `${operation}: index ${name}`)
  };
}

function transactionFailure(
  internal: ConnectionInternal<DatabaseSpec>,
  transaction: IDBTransaction,
  operation: string
): PersistenceError {
  const state = internal.state();
  if (state.reason === 'versionchange') {
    return persistenceError(
      'versionchange',
      'persistence.versionchange',
      operation,
      transaction.error,
      `Database "${internal.spec.name}" changed version during a transaction`
    );
  }
  return classifyPersistenceError(
    transaction.error ?? namedCause('AbortError', 'The IndexedDB transaction aborted'),
    operation
  );
}

export async function runTransaction<
  TSpec extends DatabaseSpec,
  const TNames extends readonly StoreName<TSpec>[],
  TResult
>(
  connection: DatabaseConnection<TSpec>,
  options: TransactionOptions<TSpec, TNames>,
  work: (transaction: TypedTransaction<TSpec, TNames[number]>) => TResult | Promise<TResult>
): Promise<TResult> {
  const internal = connectionInternals.get(connection) as ConnectionInternal<TSpec> | undefined;
  const state = connection.state();
  if (!internal || state.status === 'closed') {
    const versionChanged = state.reason === 'versionchange';
    throw persistenceError(
      versionChanged ? 'versionchange' : 'closed',
      versionChanged ? 'persistence.versionchange' : 'persistence.connection-closed',
      options.operation,
      state.error,
      versionChanged
        ? `Database "${connection.spec.name}" was closed for a version change`
        : `Database "${connection.spec.name}" is closed`
    );
  }

  let transaction: IDBTransaction;
  try {
    const transactionOptions = options.durability === undefined ? undefined : { durability: options.durability };
    transaction = internal.database.transaction([...options.stores], options.mode, transactionOptions);
  } catch (cause) {
    if (connection.state().reason === 'versionchange') {
      throw persistenceError('versionchange', 'persistence.versionchange', options.operation, cause);
    }
    throw classifyPersistenceError(cause, options.operation);
  }

  const completion = new Promise<void>((resolve, reject) => {
    let eventFailure: PersistenceError | undefined;
    transaction.oncomplete = () => {
      if (eventFailure) reject(eventFailure);
      else resolve();
    };
    transaction.onabort = () => reject(
      eventFailure ?? transactionFailure(internal, transaction, options.operation)
    );
    transaction.onerror = () => {
      eventFailure = transactionFailure(internal, transaction, options.operation);
    };
  });
  const typedTransaction: TypedTransaction<TSpec, TNames[number]> = {
    mode: transaction.mode,
    store: (name) => createTransactionStore(
      transaction.objectStore(name),
      `${options.operation}: store ${name}`
    ) as TransactionStore<StoreDefinition<TSpec, typeof name>>
  };

  let workResult: Promise<TResult>;
  try {
    workResult = Promise.resolve(work(typedTransaction));
  } catch (cause) {
    workResult = Promise.reject(cause);
  }
  let operationFailure: PersistenceError | undefined;
  const abortOnWorkFailure = workResult.catch((cause) => {
    operationFailure = classifyPersistenceError(cause, options.operation);
    try { transaction.abort(); } catch { /* A transaction that already settled still cannot make failed work succeed. */ }
    throw operationFailure;
  });
  try {
    const [result] = await Promise.all([abortOnWorkFailure, completion]);
    return result;
  } catch (cause) {
    throw operationFailure ?? cause;
  }
}
