import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ClockPort, IdPort } from '$lib/runtime/ports';
import { ResourceScope } from '$lib/runtime/resource-scope';
import {
  defineDatabase,
  defineIndex,
  defineStore,
  openDatabase,
  runTransaction,
  type DatabaseConnection,
  type DatabaseSpec,
  type IndexedDbFactoryPort
} from './indexed-db';

interface TrackRecord {
  id: string;
  title: string;
  year: number;
}

const databaseSpec = defineDatabase({
  name: 'typed-test',
  version: 3,
  stores: {
    tracks: defineStore<TrackRecord, string>()({
      keyPath: 'id',
      indexes: {
        byYear: defineIndex<number>({ keyPath: 'year' })
      }
    })
  }
});

class FakeClock implements ClockPort {
  #time = 0;
  wallNow(): number { return ++this.#time; }
  monotonicNow(): number { return ++this.#time; }
  queueMicrotask(callback: () => void): void { callback(); }
  setTimeout(): unknown { return 1; }
  clearTimeout(): void {}
  setInterval(): unknown { return 1; }
  clearInterval(): void {}
  requestAnimationFrame(): unknown { return 1; }
  cancelAnimationFrame(): void {}
}

class FakeIds implements IdPort {
  #next = 0;
  create(): string { return `persistence-${++this.#next}`; }
}

function createScope(): ResourceScope {
  return new ResourceScope('persistence test', new FakeClock(), new FakeIds());
}

function namedError(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

class FakeNames {
  constructor(private readonly values: () => string[]) {}
  get length(): number { return this.values().length; }
  contains(value: string): boolean { return this.values().includes(value); }
  item(index: number): string | null { return this.values()[index] ?? null; }
}

class FakeRequest<TResult> {
  result!: TResult;
  error: DOMException | null = null;
  onsuccess: ((this: IDBRequest<TResult>, event: Event) => unknown) | null = null;
  onerror: ((this: IDBRequest<TResult>, event: Event) => unknown) | null = null;

  succeed(result: TResult): void {
    this.result = result;
    this.onsuccess?.call(this as unknown as IDBRequest<TResult>, {} as Event);
  }

  fail(error: Error): void {
    this.error = error as DOMException;
    this.onerror?.call(this as unknown as IDBRequest<TResult>, {} as Event);
  }

  asRequest(): IDBRequest<TResult> {
    return this as unknown as IDBRequest<TResult>;
  }
}

class FakeIndex {
  readonly requests: FakeRequest<unknown>[] = [];
  readonly name: string;
  readonly keyPath: string | string[];
  readonly unique: boolean;
  readonly multiEntry: boolean;

  constructor(name: string, keyPath: string | string[], options: IDBIndexParameters = {}) {
    this.name = name;
    this.keyPath = keyPath;
    this.unique = options.unique ?? false;
    this.multiEntry = options.multiEntry ?? false;
  }

  #request<TResult>(): IDBRequest<TResult> {
    const request = new FakeRequest<TResult>();
    this.requests.push(request as FakeRequest<unknown>);
    return request.asRequest();
  }

  get(): IDBRequest<unknown> { return this.#request(); }
  getKey(): IDBRequest<IDBValidKey | undefined> { return this.#request(); }
  getAll(): IDBRequest<unknown[]> { return this.#request(); }
  getAllKeys(): IDBRequest<IDBValidKey[]> { return this.#request(); }
  count(): IDBRequest<number> { return this.#request(); }
  openKeyCursor(): IDBRequest<IDBCursor | null> { return this.#request(); }

  asIndex(): IDBIndex { return this as unknown as IDBIndex; }
}

class FakeStore {
  readonly indexes = new Map<string, FakeIndex>();
  readonly requests: FakeRequest<unknown>[] = [];
  readonly name: string;
  readonly keyPath: string | string[] | null;
  readonly autoIncrement: boolean;

  constructor(name: string, options: IDBObjectStoreParameters = {}) {
    this.name = name;
    this.keyPath = options.keyPath ?? null;
    this.autoIncrement = options.autoIncrement ?? false;
  }

  get indexNames(): DOMStringList {
    return new FakeNames(() => [...this.indexes.keys()]) as unknown as DOMStringList;
  }

  createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters): IDBIndex {
    const index = new FakeIndex(name, keyPath, options);
    this.indexes.set(name, index);
    return index.asIndex();
  }

  index(name: string): IDBIndex {
    const index = this.indexes.get(name);
    if (!index) throw namedError('NotFoundError');
    return index.asIndex();
  }

  #request<TResult>(): IDBRequest<TResult> {
    const request = new FakeRequest<TResult>();
    this.requests.push(request as FakeRequest<unknown>);
    return request.asRequest();
  }

  get(): IDBRequest<unknown> { return this.#request(); }
  getAll(): IDBRequest<unknown[]> { return this.#request(); }
  getAllKeys(): IDBRequest<IDBValidKey[]> { return this.#request(); }
  put(): IDBRequest<IDBValidKey> { return this.#request(); }
  add(): IDBRequest<IDBValidKey> { return this.#request(); }
  delete(): IDBRequest<undefined> { return this.#request(); }
  clear(): IDBRequest<undefined> { return this.#request(); }
  count(): IDBRequest<number> { return this.#request(); }

  asStore(): IDBObjectStore { return this as unknown as IDBObjectStore; }
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onabort: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  abortCalls = 0;

  constructor(
    readonly mode: IDBTransactionMode,
    private readonly stores: Map<string, FakeStore>
  ) {}

  objectStore(name: string): IDBObjectStore {
    const store = this.stores.get(name);
    if (!store) throw namedError('NotFoundError');
    return store.asStore();
  }

  abort(): void {
    this.abortCalls += 1;
    this.abortWith();
  }

  complete(): void {
    this.oncomplete?.call(this.asTransaction(), {} as Event);
  }

  abortWith(error?: Error): void {
    this.error = (error ?? null) as DOMException | null;
    this.onabort?.call(this.asTransaction(), {} as Event);
  }

  fail(error: Error): void {
    this.error = error as DOMException;
    this.onerror?.call(this.asTransaction(), {} as Event);
    this.onabort?.call(this.asTransaction(), {} as Event);
  }

  asTransaction(): IDBTransaction { return this as unknown as IDBTransaction; }
}

class FakeDatabase {
  readonly stores = new Map<string, FakeStore>();
  closeCalls = 0;
  onversionchange: ((this: IDBDatabase, event: IDBVersionChangeEvent) => unknown) | null = null;
  nextTransaction?: FakeTransaction;

  get objectStoreNames(): DOMStringList {
    return new FakeNames(() => [...this.stores.keys()]) as unknown as DOMStringList;
  }

  createObjectStore(name: string, options?: IDBObjectStoreParameters): IDBObjectStore {
    const store = new FakeStore(name, options);
    this.stores.set(name, store);
    return store.asStore();
  }

  deleteObjectStore(name: string): void { this.stores.delete(name); }

  transaction(storeNames: string | Iterable<string>, mode: IDBTransactionMode = 'readonly'): IDBTransaction {
    const names = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
    if (names.some((name) => !this.stores.has(name))) throw namedError('NotFoundError');
    if (this.nextTransaction) {
      const transaction = this.nextTransaction;
      this.nextTransaction = undefined;
      return transaction.asTransaction();
    }
    return new FakeTransaction(mode, this.stores).asTransaction();
  }

  close(): void { this.closeCalls += 1; }

  versionChange(oldVersion: number, newVersion: number | null): void {
    this.onversionchange?.call(this.asDatabase(), { oldVersion, newVersion } as IDBVersionChangeEvent);
  }

  asDatabase(): IDBDatabase { return this as unknown as IDBDatabase; }
}

class FakeOpenRequest extends FakeRequest<IDBDatabase> {
  onblocked: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null = null;
  onupgradeneeded: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null = null;
  transaction: IDBTransaction | null = null;
  upgradeTransaction?: FakeTransaction;

  constructor(readonly database: FakeDatabase) {
    super();
    this.result = database.asDatabase();
  }

  upgrade(oldVersion = 0, newVersion = databaseSpec.version): void {
    this.upgradeTransaction = new FakeTransaction('versionchange', this.database.stores);
    this.transaction = this.upgradeTransaction.asTransaction();
    this.onupgradeneeded?.call(
      this as unknown as IDBOpenDBRequest,
      { oldVersion, newVersion } as IDBVersionChangeEvent
    );
  }

  blocked(oldVersion = 2, newVersion = databaseSpec.version): void {
    this.onblocked?.call(
      this as unknown as IDBOpenDBRequest,
      { oldVersion, newVersion } as IDBVersionChangeEvent
    );
  }

  succeedOpen(): void { this.succeed(this.database.asDatabase()); }
  asOpenRequest(): IDBOpenDBRequest { return this as unknown as IDBOpenDBRequest; }
}

class FakeFactory implements IndexedDbFactoryPort {
  readonly database = new FakeDatabase();
  readonly request = new FakeOpenRequest(this.database);
  openCalls: Array<{ name: string; version?: number }> = [];
  throwOnOpen?: Error;

  open(name: string, version?: number): IDBOpenDBRequest {
    this.openCalls.push({ name, version });
    if (this.throwOnOpen) throw this.throwOnOpen;
    return this.request.asOpenRequest();
  }
}

async function openFresh(
  scope = createScope(),
  factory = new FakeFactory()
): Promise<{ connection: DatabaseConnection<typeof databaseSpec>; factory: FakeFactory; scope: ResourceScope }> {
  const opening = openDatabase(databaseSpec, scope, factory);
  factory.request.upgrade();
  factory.request.succeedOpen();
  return { connection: await opening, factory, scope };
}

describe('typed IndexedDB persistence kernel', () => {
  it('carries record, primary-key, and index-key types through transactions', async () => {
    const { connection, factory } = await openFresh();
    const transaction = new FakeTransaction('readonly', factory.database.stores);
    factory.database.nextTransaction = transaction;

    const result = runTransaction(connection, {
      stores: ['tracks'], mode: 'readonly', operation: 'type projection'
    }, (typed) => {
      expectTypeOf(typed.store('tracks').get('track-id')).toEqualTypeOf<Promise<TrackRecord | undefined>>();
      expectTypeOf(typed.store('tracks').index('byYear').get(2026)).toEqualTypeOf<Promise<TrackRecord | undefined>>();
      return 'typed';
    });
    transaction.complete();

    await expect(result).resolves.toBe('typed');
  });

  it('deletes every primary record selected through a typed index cursor', async () => {
    const { connection, factory } = await openFresh();
    const transaction = new FakeTransaction('readwrite', factory.database.stores);
    factory.database.nextTransaction = transaction;

    const result = runTransaction(connection, {
      stores: ['tracks'], mode: 'readwrite', operation: 'delete tracks by year'
    }, (typed) => typed.store('tracks').index('byYear').deleteAll(2026));
    const cursorRequest = factory.database.stores.get('tracks')!
      .indexes.get('byYear')!.requests.at(-1)!;
    const deletion = new FakeRequest<undefined>();
    const cursor = {
      delete: () => deletion.asRequest(),
      continue: () => cursorRequest.succeed(null)
    } as unknown as IDBCursor;
    cursorRequest.succeed(cursor);
    deletion.succeed(undefined);
    transaction.complete();

    await expect(result).resolves.toBe(1);
  });

  it('rebuilds only the clean current schema and releases a manually closed connection once', async () => {
    const scope = createScope();
    const factory = new FakeFactory();
    factory.database.createObjectStore('legacy', { keyPath: 'oldId' });

    const opening = openDatabase(databaseSpec, scope, factory);
    factory.request.upgrade(2, 3);
    factory.request.succeedOpen();
    const connection = await opening;

    expect(factory.openCalls).toEqual([{ name: 'typed-test', version: 3 }]);
    expect([...factory.database.stores.keys()]).toEqual(['tracks']);
    expect(factory.database.stores.get('tracks')).toMatchObject({ keyPath: 'id', autoIncrement: false });
    expect([...factory.database.stores.get('tracks')!.indexes.keys()]).toEqual(['byYear']);

    await connection.close();
    await connection.close();
    expect(factory.database.closeCalls).toBe(1);
    await expect(connection.closed).resolves.toMatchObject({ status: 'closed', reason: 'manual' });
    expect(scope.diagnostic()).toMatchObject({
      counts: { active: 0, released: 1 },
      resources: [expect.objectContaining({ kind: 'database-connection', label: 'indexed-db:typed-test' })]
    });
  });

  it('closes a live connection when its owning scope is disposed', async () => {
    const { connection, factory, scope } = await openFresh();

    const firstDisposal = scope.dispose();
    const repeatedDisposal = scope.dispose();
    expect(repeatedDisposal).toBe(firstDisposal);
    await firstDisposal;

    expect(factory.database.closeCalls).toBe(1);
    await expect(connection.closed).resolves.toMatchObject({ status: 'closed', reason: 'scope' });
  });

  it('rejects blocked opens and closes a database that succeeds after the rejection', async () => {
    const factory = new FakeFactory();
    const opening = openDatabase(databaseSpec, createScope(), factory);

    factory.request.blocked();
    await expect(opening).rejects.toMatchObject({
      category: 'blocked', code: 'persistence.open-blocked', retryable: true
    });
    factory.request.upgrade();
    factory.request.succeedOpen();

    expect(factory.database.closeCalls).toBe(1);
    expect(factory.request.upgradeTransaction?.abortCalls).toBe(1);
    expect(factory.database.stores.size).toBe(0);
  });

  it('classifies unavailable, quota, and version failures without browser globals', async () => {
    await expect(openDatabase(databaseSpec, createScope(), undefined)).rejects.toMatchObject({
      category: 'unavailable', code: 'persistence.indexed-db-unavailable'
    });

    const quotaFactory = new FakeFactory();
    quotaFactory.throwOnOpen = namedError('QuotaExceededError');
    await expect(openDatabase(databaseSpec, createScope(), quotaFactory)).rejects.toMatchObject({
      category: 'quota', code: 'persistence.quota-exceeded'
    });

    const versionFactory = new FakeFactory();
    const opening = openDatabase(databaseSpec, createScope(), versionFactory);
    versionFactory.request.fail(namedError('VersionError'));
    await expect(opening).rejects.toMatchObject({
      category: 'versionchange', code: 'persistence.versionchange'
    });
  });

  it('rejects an opened database whose same-version schema is corrupt', async () => {
    const factory = new FakeFactory();
    factory.database.createObjectStore('wrong', { keyPath: 'id' });
    const opening = openDatabase(databaseSpec, createScope(), factory);

    factory.request.succeedOpen();

    await expect(opening).rejects.toMatchObject({
      category: 'corrupt', code: 'persistence.schema-corrupt'
    });
    expect(factory.database.closeCalls).toBe(1);
  });

  it('closes stale connections on versionchange and reports the close to later transactions', async () => {
    const { connection, factory } = await openFresh();

    factory.database.versionChange(3, 4);

    await expect(connection.closed).resolves.toMatchObject({
      status: 'closed', reason: 'versionchange', oldVersion: 3, newVersion: 4
    });
    expect(factory.database.closeCalls).toBe(1);
    await expect(runTransaction(connection, {
      stores: ['tracks'], mode: 'readonly', operation: 'read after versionchange'
    }, () => undefined)).rejects.toMatchObject({
      category: 'versionchange', code: 'persistence.versionchange'
    });
  });

  it('does not resolve a transaction until its operation and commit both complete', async () => {
    const { connection, factory } = await openFresh();
    const transaction = new FakeTransaction('readwrite', factory.database.stores);
    factory.database.nextTransaction = transaction;
    let settled = false;

    const result = runTransaction(connection, {
      stores: ['tracks'], mode: 'readwrite', operation: 'update title'
    }, () => 'updated').then((value) => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);

    transaction.complete();
    await expect(result).resolves.toBe('updated');
  });

  it('projects transaction abort and error events instead of treating them as empty results', async () => {
    const { connection, factory } = await openFresh();
    const aborted = new FakeTransaction('readonly', factory.database.stores);
    factory.database.nextTransaction = aborted;
    const abortedResult = runTransaction(connection, {
      stores: ['tracks'], mode: 'readonly', operation: 'aborted read'
    }, () => undefined);
    aborted.abortWith();
    await expect(abortedResult).rejects.toMatchObject({
      category: 'abort', code: 'persistence.transaction-aborted'
    });

    const failed = new FakeTransaction('readwrite', factory.database.stores);
    factory.database.nextTransaction = failed;
    const failedResult = runTransaction(connection, {
      stores: ['tracks'], mode: 'readwrite', operation: 'quota write'
    }, () => undefined);
    failed.fail(namedError('QuotaExceededError'));
    await expect(failedResult).rejects.toMatchObject({
      category: 'quota', code: 'persistence.quota-exceeded'
    });
  });

  it('aborts when work or a typed request fails and preserves the first useful failure', async () => {
    const { connection, factory } = await openFresh();
    const thrown = new FakeTransaction('readwrite', factory.database.stores);
    factory.database.nextTransaction = thrown;
    await expect(runTransaction(connection, {
      stores: ['tracks'], mode: 'readwrite', operation: 'throwing work'
    }, () => { throw namedError('NotReadableError', 'disk vanished'); })).rejects.toMatchObject({
      category: 'io', code: 'persistence.io-failed', safeCause: { message: 'disk vanished' }
    });
    expect(thrown.abortCalls).toBe(1);

    const requestFailure = new FakeTransaction('readwrite', factory.database.stores);
    factory.database.nextTransaction = requestFailure;
    const result = runTransaction(connection, {
      stores: ['tracks'], mode: 'readwrite', operation: 'typed put'
    }, (transaction) => transaction.store('tracks').put({ id: 'one', title: 'One', year: 2026 }));
    const putRequest = factory.database.stores.get('tracks')!.requests.at(-1)!;
    putRequest.fail(namedError('QuotaExceededError', 'full'));
    await expect(result).rejects.toMatchObject({
      category: 'quota', code: 'persistence.quota-exceeded', safeCause: { message: 'full' }
    });
    expect(requestFailure.abortCalls).toBe(1);
  });

  it('reports versionchange when a live transaction is aborted by a stale-connection close', async () => {
    const { connection, factory } = await openFresh();
    const transaction = new FakeTransaction('readwrite', factory.database.stores);
    factory.database.nextTransaction = transaction;
    const result = runTransaction(connection, {
      stores: ['tracks'], mode: 'readwrite', operation: 'interrupted write'
    }, () => undefined);

    factory.database.versionChange(3, 4);
    transaction.abortWith();

    await expect(result).rejects.toMatchObject({
      category: 'versionchange', code: 'persistence.versionchange'
    });
  });
});
