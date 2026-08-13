import type { PlaylistPlaybackOptions, PlaylistSelection } from '$lib/contracts/catalog';
import {
  EMPTY_COLLECTION_SELECTION,
  reduceCollection,
  type CollectionCommand,
  type CollectionEntity,
  type CollectionPolicy,
  type CollectionReduction,
  type CollectionState
} from './collection-reducer';

export interface CollectionRecord<TEntity extends CollectionEntity> {
  readonly entities: readonly TEntity[];
  readonly selection: PlaylistSelection;
  readonly playbackOptions: PlaylistPlaybackOptions;
}

export interface LoadedCollectionRecord<TEntity extends CollectionEntity> {
  readonly record: CollectionRecord<TEntity>;
  readonly requiresRewrite?: boolean;
}

export interface CollectionStorage<TEntity extends CollectionEntity> {
  load(): Promise<LoadedCollectionRecord<TEntity> | null>;
  save(record: CollectionRecord<TEntity>): Promise<void>;
}

export interface CollectionScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type CollectionRepositoryPhase =
  | 'idle'
  | 'hydrating'
  | 'ready'
  | 'persisting'
  | 'degraded'
  | 'shutting-down'
  | 'disposed';

export interface CollectionRepositoryStatus {
  readonly phase: CollectionRepositoryPhase;
  readonly dirty: boolean;
  readonly revision: number;
  readonly persistedRevision: number;
  readonly error: unknown | null;
}

export type ConditionalCollectionResult<TEntity extends CollectionEntity> =
  | { readonly status: 'applied'; readonly reduction: CollectionReduction<TEntity> }
  | { readonly status: 'conflict'; readonly actualCatalogRevision: number };

export interface CollectionRepositoryOptions<TEntity extends CollectionEntity> {
  readonly storage: CollectionStorage<TEntity>;
  readonly scheduler: CollectionScheduler;
  readonly policy: CollectionPolicy<TEntity>;
  readonly defaultPlaybackOptions: PlaylistPlaybackOptions;
  readonly persistDelayMs?: number;
  /** Starts an explicitly ephemeral repository ready without consulting storage. */
  readonly initiallyHydrated?: boolean;
}

type StateListener<TEntity extends CollectionEntity> = (state: CollectionState<TEntity>) => void;
type StatusListener = (status: CollectionRepositoryStatus) => void;

function recordOf<TEntity extends CollectionEntity>(
  state: CollectionState<TEntity>
): CollectionRecord<TEntity> {
  return {
    entities: state.entities,
    selection: state.selection,
    playbackOptions: state.playbackOptions
  };
}

export class CollectionRepository<TEntity extends CollectionEntity> {
  readonly #storage: CollectionStorage<TEntity>;
  readonly #scheduler: CollectionScheduler;
  readonly #policy: CollectionPolicy<TEntity>;
  readonly #persistDelayMs: number;
  readonly #stateListeners = new Set<StateListener<TEntity>>();
  readonly #statusListeners = new Set<StatusListener>();
  readonly #queuedCommands: CollectionCommand<TEntity>[] = [];
  #state: CollectionState<TEntity>;
  #status: CollectionRepositoryStatus;
  #hydratePromise: Promise<void> | null = null;
  #hydratedSuccessfully = false;
  #operationChain = Promise.resolve();
  #pendingOperationCount = 0;
  #persistTimer: unknown | null = null;
  #scheduledPersistDelayMs = Number.POSITIVE_INFINITY;
  #flushPromise: Promise<void> | null = null;
  #shutdownPromise: Promise<void> | null = null;

  constructor(options: CollectionRepositoryOptions<TEntity>) {
    this.#storage = options.storage;
    this.#scheduler = options.scheduler;
    this.#policy = options.policy;
    this.#persistDelayMs = Math.max(0, options.persistDelayMs ?? 400);
    this.#state = {
      entities: [],
      selection: EMPTY_COLLECTION_SELECTION,
      playbackOptions: options.defaultPlaybackOptions,
      catalogRevision: 0,
      revision: 0
    };
    this.#status = {
      phase: options.initiallyHydrated ? 'ready' : 'idle',
      dirty: false,
      revision: 0,
      persistedRevision: 0,
      error: null
    };
    if (options.initiallyHydrated) {
      this.#hydratedSuccessfully = true;
      this.#hydratePromise = Promise.resolve();
    }
  }

  getSnapshot(): CollectionState<TEntity> {
    return this.#state;
  }

  getStatus(): CollectionRepositoryStatus {
    return this.#status;
  }

  subscribe(listener: StateListener<TEntity>): () => void {
    this.#stateListeners.add(listener);
    listener(this.#state);
    return () => this.#stateListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.#statusListeners.add(listener);
    listener(this.#status);
    return () => this.#statusListeners.delete(listener);
  }

  hydrate(): Promise<void> {
    if (this.#hydratePromise) return this.#hydratePromise;
    if (this.#status.phase === 'disposed' || this.#status.phase === 'shutting-down') {
      return Promise.reject(new Error('The collection repository is shutting down.'));
    }
    this.#setStatus({ phase: 'hydrating', error: null });
    this.#hydratePromise = (async () => {
      let loaded: LoadedCollectionRecord<TEntity> | null = null;
      try {
        loaded = await this.#storage.load();
        if (loaded) {
          this.#apply({
            type: 'hydrate',
            entities: loaded.record.entities,
            selection: loaded.record.selection,
            playbackOptions: loaded.record.playbackOptions
          }, false);
        }
        this.#status = {
          phase: 'ready',
          dirty: loaded?.requiresRewrite === true,
          revision: this.#state.revision,
          persistedRevision: loaded?.requiresRewrite === true
            ? Math.max(0, this.#state.revision - 1)
            : this.#state.revision,
          error: null
        };
        this.#hydratedSuccessfully = true;
        this.#emitStatus();
      } catch (error) {
        this.#hydratedSuccessfully = false;
        this.#setStatus({ phase: 'degraded', error });
      }

      if (this.#status.dirty) this.#schedulePersist();
    })();
    return this.#hydratePromise;
  }

  retryHydrate(): Promise<void> {
    if (this.#hydratedSuccessfully) return this.#hydratePromise ?? Promise.resolve();
    if (this.#status.phase === 'disposed' || this.#status.phase === 'shutting-down') {
      return Promise.reject(new Error('The collection repository is shutting down.'));
    }
    this.#hydratePromise = null;
    return this.hydrate();
  }

  async ready(): Promise<void> {
    await this.hydrate();
    await this.#operationChain;
  }

  dispatch(
    command: CollectionCommand<TEntity>,
    persistDelayMs = this.#persistDelayMs
  ): Promise<CollectionReduction<TEntity>> {
    return this.#dispatch(command, null, persistDelayMs).then((result) => {
      if (result.status === 'conflict') throw new Error('Unexpected collection revision conflict.');
      return result.reduction;
    });
  }

  dispatchIfCatalogRevision(
    expectedCatalogRevision: number,
    command: CollectionCommand<TEntity>,
    persistDelayMs = this.#persistDelayMs
  ): Promise<ConditionalCollectionResult<TEntity>> {
    return this.#dispatch(command, expectedCatalogRevision, persistDelayMs);
  }

  requestPersist(delayMs = this.#persistDelayMs): void {
    if (this.#status.dirty) this.#schedulePersist(delayMs);
  }

  #dispatch(
    command: CollectionCommand<TEntity>,
    expectedCatalogRevision: number | null,
    persistDelayMs: number
  ): Promise<ConditionalCollectionResult<TEntity>> {
    if (this.#status.phase === 'disposed' || this.#status.phase === 'shutting-down') {
      return Promise.reject(new Error('The collection repository is shutting down.'));
    }
    if (this.#hydratedSuccessfully && this.#pendingOperationCount === 0) {
      if (
        expectedCatalogRevision !== null
        && this.#state.catalogRevision !== expectedCatalogRevision
      ) {
        return Promise.resolve({
          status: 'conflict',
          actualCatalogRevision: this.#state.catalogRevision
        });
      }
      return Promise.resolve({ status: 'applied', reduction: this.#apply(command, true, persistDelayMs) });
    }
    if (!this.#hydratePromise || this.#status.phase === 'hydrating') {
      this.#queuedCommands.push(command);
    }
    this.#pendingOperationCount += 1;
    const run = this.#operationChain.then(async () => {
      await this.hydrate();
      if (!this.#hydratedSuccessfully) await this.retryHydrate();
      if (!this.#hydratedSuccessfully) {
        const error = this.#status.error ?? new Error('Collection hydration did not complete.');
        const queuedIndex = this.#queuedCommands.indexOf(command);
        if (queuedIndex >= 0) this.#queuedCommands.splice(queuedIndex, 1);
        throw error;
      }
      const queuedIndex = this.#queuedCommands.indexOf(command);
      if (queuedIndex >= 0) this.#queuedCommands.splice(queuedIndex, 1);
      if (
        expectedCatalogRevision !== null
        && this.#state.catalogRevision !== expectedCatalogRevision
      ) {
        return {
          status: 'conflict' as const,
          actualCatalogRevision: this.#state.catalogRevision
        };
      }
      return { status: 'applied' as const, reduction: this.#apply(command, true, persistDelayMs) };
    }).finally(() => {
      this.#pendingOperationCount -= 1;
    });
    this.#operationChain = run.then(() => undefined, () => undefined);
    return run;
  }

  flush(): Promise<void> {
    if (this.#status.phase === 'disposed') return Promise.resolve();
    if (this.#persistTimer !== null) {
      this.#scheduler.clearTimeout(this.#persistTimer);
      this.#persistTimer = null;
      this.#scheduledPersistDelayMs = Number.POSITIVE_INFINITY;
    }
    if (this.#flushPromise) return this.#flushPromise;
    this.#flushPromise = (async () => {
      await this.#operationChain;
      await this.hydrate();
      while (this.#status.persistedRevision < this.#state.revision || this.#status.dirty) {
        const targetRevision = this.#state.revision;
        const record = recordOf(this.#state);
        this.#setStatus({ phase: 'persisting', error: null, dirty: true });
        try {
          await this.#storage.save(record);
        } catch (error) {
          this.#setStatus({ phase: 'degraded', error, dirty: true });
          throw error;
        }
        this.#setStatus({
          phase: 'ready',
          error: null,
          persistedRevision: targetRevision,
          dirty: targetRevision < this.#state.revision
        });
      }
    })().finally(() => {
      this.#flushPromise = null;
    });
    return this.#flushPromise;
  }

  shutdown(): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    if (this.#status.phase === 'disposed') return Promise.resolve();
    this.#shutdownPromise = (async () => {
      await this.hydrate();
      this.#setStatus({ phase: 'shutting-down' });
      try {
        await this.#operationChain;
        await this.flush();
      } finally {
        if (this.#persistTimer !== null) {
          this.#scheduler.clearTimeout(this.#persistTimer);
          this.#persistTimer = null;
          this.#scheduledPersistDelayMs = Number.POSITIVE_INFINITY;
        }
        this.#status = {
          ...this.#status,
          phase: 'disposed',
          dirty: this.#status.persistedRevision < this.#state.revision
        };
        this.#emitStatus();
        this.#stateListeners.clear();
        this.#statusListeners.clear();
      }
    })();
    return this.#shutdownPromise;
  }

  #apply(
    command: CollectionCommand<TEntity>,
    persist: boolean,
    persistDelayMs = this.#persistDelayMs
  ): CollectionReduction<TEntity> {
    const reduction = reduceCollection(this.#state, command, this.#policy);
    if (!reduction.changed) return reduction;
    this.#state = reduction.state;
    for (const listener of this.#stateListeners) listener(this.#state);
    if (persist) {
      this.#setStatus({
        dirty: true,
        revision: this.#state.revision,
        ...(this.#status.phase === 'degraded' ? {} : { phase: 'ready', error: null })
      });
      this.#schedulePersist(persistDelayMs);
    } else {
      this.#setStatus({ revision: this.#state.revision });
    }
    return reduction;
  }

  #schedulePersist(delayMs = this.#persistDelayMs): void {
    if (this.#status.phase === 'disposed' || this.#status.phase === 'shutting-down') return;
    const normalizedDelay = Math.max(0, delayMs);
    if (this.#persistTimer !== null && this.#scheduledPersistDelayMs <= normalizedDelay) return;
    if (this.#persistTimer !== null) this.#scheduler.clearTimeout(this.#persistTimer);
    this.#scheduledPersistDelayMs = normalizedDelay;
    this.#persistTimer = this.#scheduler.setTimeout(() => {
      this.#persistTimer = null;
      this.#scheduledPersistDelayMs = Number.POSITIVE_INFINITY;
      void this.flush().catch(() => undefined);
    }, normalizedDelay);
  }

  #setStatus(patch: Partial<CollectionRepositoryStatus>): void {
    this.#status = {
      ...this.#status,
      ...patch,
      revision: patch.revision ?? this.#state.revision
    };
    this.#emitStatus();
  }

  #emitStatus(): void {
    for (const listener of this.#statusListeners) listener(this.#status);
  }
}
