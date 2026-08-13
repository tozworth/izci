import type { MediaEntity } from '$lib/contracts/catalog';
import type { TrackMetadata } from '$lib/contracts/media-metadata';
import { InspectionWorkCancelledError } from '$lib/media/inspection-work-queue';
import { BrowserClock } from '$lib/runtime/adapters/browser-clock';
import { BrowserId } from '$lib/runtime/adapters/browser-id';
import {
  BrowserAbortControllers,
  BrowserObjectUrls
} from '$lib/runtime/adapters/browser-resources';
import type { AbortControllerPort, IdPort, ObjectUrlPort } from '$lib/runtime/ports';
import { mediaSources } from '$lib/media/media-source';
import { loadModuleMetadataFromFile } from '$lib/services/module-metadata';
import { loadTrackLyricsFromFile, type LoadedLyrics } from '$lib/services/lyrics';
import { readMetadataDocument } from '$lib/services/media-metadata/reader';
import {
  MediaInspectionPipeline,
  type MediaInspectionContext,
  type MediaInspectionOrigin,
  type MediaInspectionResult,
  type MediaInspectionTicket
} from '$lib/services/media-inspection-pipeline';
import {
  createLoadedStreamArtwork,
  loadEmbeddedStreamArtworkFromFile,
  loadTrackMetadataFromFile,
  type EmbeddedStreamArtwork,
  type LoadedStreamArtwork
} from '$lib/services/stream-artwork';
import type { MetadataDocument } from '$lib/services/media-metadata/types';
import { materializeMediaEntity } from '$lib/stores/playlist-materialization';

const CATALOG_METADATA_TIMEOUT_MS = 15_000;
const MEDIA_DURATION_TIMEOUT_MS = 10_000;
const MAX_INSPECTION_CONCURRENCY = 3;
const MAX_BACKGROUND_INSPECTION_CONCURRENCY = 2;
const MAX_QUEUED_INSPECTIONS = 32;
const MAX_ON_DEMAND_CACHE_ENTRIES = 64;
const MAX_CATALOG_BATCH_PRODUCERS = 4;

export interface CatalogMetadataReaders {
  readonly readStream: (
    file: File,
    format: string,
    signal: AbortSignal
  ) => TrackMetadata | null | Promise<TrackMetadata | null>;
  readonly readModule: (
    entity: MediaEntity,
    file: File,
    signal: AbortSignal
  ) => TrackMetadata | null | Promise<TrackMetadata | null>;
  readonly readDuration: (
    file: File,
    signal: AbortSignal
  ) => number | undefined | Promise<number | undefined>;
}

export interface MediaInspectionReaders extends CatalogMetadataReaders {
  readonly readArtwork: (
    file: File,
    format: string,
    signal: AbortSignal
  ) => EmbeddedStreamArtwork | null | Promise<EmbeddedStreamArtwork | null>;
  readonly readLyrics: (
    file: File,
    format: string,
    signal: AbortSignal
  ) => LoadedLyrics | null | Promise<LoadedLyrics | null>;
  readonly readDocument: (
    file: File,
    format: string,
    signal: AbortSignal
  ) => MetadataDocument | null | Promise<MetadataDocument | null>;
}

export type CatalogMetadataInspectionResult = MediaInspectionResult<'catalog-metadata'>;

export interface CatalogMetadataInspectionBatch {
  readonly generationId: string;
  readonly settled: Promise<void>;
  cancel(): boolean;
}

export interface CatalogMetadataInspectionOptions {
  readonly origin: MediaInspectionOrigin;
  readonly signal?: AbortSignal;
  readonly onResult: (
    result: CatalogMetadataInspectionResult
  ) => void | Promise<void>;
  readonly onError?: (error: unknown, entity: MediaEntity) => void;
}

interface CatalogMetadataPipelinePort {
  inspect(request: {
    readonly kind: 'catalog-metadata';
    readonly entity: MediaEntity;
    readonly generationId: string;
    readonly origin: MediaInspectionOrigin;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  }): MediaInspectionTicket<'catalog-metadata'> | Promise<MediaInspectionTicket<'catalog-metadata'>>;
  dispose(): Promise<void>;
}

function mergeDuration(
  metadata: TrackMetadata | null,
  duration: number | undefined
): TrackMetadata | null {
  if (duration === undefined || duration <= 0 || metadata?.duration) return metadata;
  return { ...(metadata ?? {}), duration };
}

export function createCatalogMetadataHandler(
  readers: CatalogMetadataReaders
): (context: MediaInspectionContext) => Promise<TrackMetadata | null> {
  return async ({ entity, file, signal }) => {
    if (signal.aborted) return null;
    if (entity.kind === 'module') {
      return await readers.readModule(entity, file, signal);
    }
    if (entity.kind !== 'stream') return null;

    const metadata = await readers.readStream(file, entity.format, signal);
    if (signal.aborted || (metadata?.duration ?? 0) > 0) return metadata;
    return mergeDuration(metadata, await readers.readDuration(file, signal));
  };
}

export function createMediaInspectionHandlers(readers: MediaInspectionReaders) {
  return {
    'catalog-metadata': createCatalogMetadataHandler(readers),
    'embedded-artwork': ({ entity, file, signal }: MediaInspectionContext) =>
      readers.readArtwork(file, entity.format, signal),
    'embedded-lyrics': ({ entity, file, signal }: MediaInspectionContext) =>
      readers.readLyrics(file, entity.format, signal),
    'metadata-document': ({ entity, file, signal }: MediaInspectionContext) =>
      readers.readDocument(file, entity.format, signal)
  };
}

export class CatalogMetadataInspectionOwner {
  readonly #pipeline: CatalogMetadataPipelinePort;
  readonly #ids: IdPort;
  readonly #abortControllers: AbortControllerPort;
  readonly #active = new Set<AbortController>();
  #disposed = false;
  #disposePromise: Promise<void> | undefined;

  constructor(
    pipeline: CatalogMetadataPipelinePort,
    ids: IdPort,
    abortControllers: AbortControllerPort
  ) {
    this.#pipeline = pipeline;
    this.#ids = ids;
    this.#abortControllers = abortControllers;
  }

  inspect(
    entities: readonly MediaEntity[],
    options: CatalogMetadataInspectionOptions
  ): CatalogMetadataInspectionBatch {
    const generationId = this.#ids.create();
    const controller = this.#abortControllers.create();
    let cancelled = false;

    if (this.#disposed || options.signal?.aborted) controller.abort();
    const forwardAbort = () => controller.abort();
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    this.#active.add(controller);

    let nextIndex = 0;
    const workerCount = Math.min(MAX_CATALOG_BATCH_PRODUCERS, entities.length);
    const operations = Array.from({ length: workerCount }, async () => {
      while (!controller.signal.aborted && nextIndex < entities.length) {
        const entity = entities[nextIndex++]!;
        try {
          const ticket = await this.#pipeline.inspect({
            kind: 'catalog-metadata',
            entity,
            generationId,
            origin: options.origin,
            signal: controller.signal,
            timeoutMs: CATALOG_METADATA_TIMEOUT_MS
          });
          const result = await ticket.result;
          if (!controller.signal.aborted) await options.onResult(result);
        } catch (error) {
          if (!(error instanceof InspectionWorkCancelledError)) {
            options.onError?.(error, entity);
          }
        }
      }
    });

    const settled = Promise.allSettled(operations).then(() => {
      options.signal?.removeEventListener('abort', forwardAbort);
      this.#active.delete(controller);
    });

    return {
      generationId,
      settled,
      cancel() {
        if (cancelled || controller.signal.aborted) return false;
        cancelled = true;
        controller.abort();
        return true;
      }
    };
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    for (const controller of this.#active) controller.abort();
    this.#disposePromise = this.#pipeline.dispose();
    return this.#disposePromise;
  }
}

function readNativeAudioDuration(
  file: File,
  signal: AbortSignal,
  objectUrls: ObjectUrlPort
): Promise<number | undefined> {
  if (typeof Audio === 'undefined' || signal.aborted) return Promise.resolve(undefined);

  const objectUrl = objectUrls.create(file);
  return new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
      audio.src = '';
      objectUrls.revoke(objectUrl);
      resolve(duration);
    };
    const handleAbort = () => finish();
    const handleError = () => finish();
    const handleLoadedMetadata = () => finish(
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined
    );
    const timeout = window.setTimeout(handleError, MEDIA_DURATION_TIMEOUT_MS);

    signal.addEventListener('abort', handleAbort, { once: true });
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    audio.addEventListener('error', handleError, { once: true });
    audio.src = objectUrl;
    if (signal.aborted) finish();
  });
}

let browserOwner: CatalogMetadataInspectionOwner | undefined;
let browserPipeline: MediaInspectionPipeline | undefined;
const onDemandResults = new Map<string, Promise<unknown>>();

function cacheOnDemand<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = onDemandResults.get(key) as Promise<T> | undefined;
  if (cached) {
    onDemandResults.delete(key);
    onDemandResults.set(key, cached);
    return cached;
  }
  const pending = load().catch((error: unknown) => {
    onDemandResults.delete(key);
    throw error;
  });
  onDemandResults.set(key, pending);
  while (onDemandResults.size > MAX_ON_DEMAND_CACHE_ENTRIES) {
    const oldest = onDemandResults.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    onDemandResults.delete(oldest);
  }
  return pending;
}

function getBrowserOwner(): CatalogMetadataInspectionOwner | null {
  if (typeof window === 'undefined') return null;
  if (browserOwner) return browserOwner;

  const abortControllers = new BrowserAbortControllers(window);
  const objectUrls = new BrowserObjectUrls(window);
  const readers: MediaInspectionReaders = {
    readStream: (file, format) => loadTrackMetadataFromFile(file, format),
    readModule: (entity, file, signal) => loadModuleMetadataFromFile(entity, file, signal),
    readDuration: (file, signal) => readNativeAudioDuration(file, signal, objectUrls),
    readArtwork: (file, format, signal) => loadEmbeddedStreamArtworkFromFile(file, format, signal),
    readLyrics: (file, format, signal) => loadTrackLyricsFromFile(file, format, signal),
    readDocument: (file, format, signal) => readMetadataDocument(file, format, signal)
  };
  const pipeline = new MediaInspectionPipeline({
    maxConcurrency: MAX_INSPECTION_CONCURRENCY,
    maxBackgroundConcurrency: MAX_BACKGROUND_INSPECTION_CONCURRENCY,
    maxQueued: MAX_QUEUED_INSPECTIONS,
    clock: new BrowserClock(window, () => window.Date.now(), () => window.performance.now()),
    abortControllers,
    defaultTimeoutMs: CATALOG_METADATA_TIMEOUT_MS,
    materialize: (entity) => materializeMediaEntity(entity, false, 'file-read'),
    handlers: createMediaInspectionHandlers(readers)
  });
  browserPipeline = pipeline;
  browserOwner = new CatalogMetadataInspectionOwner(
    pipeline,
    new BrowserId(window.crypto),
    abortControllers
  );
  return browserOwner;
}

async function inspectOnDemand<TKind extends 'catalog-metadata' | 'embedded-artwork' | 'embedded-lyrics' | 'metadata-document'>(
  kind: TKind,
  entity: MediaEntity,
  origin: MediaInspectionOrigin,
  signal?: AbortSignal
): Promise<MediaInspectionResult<TKind>['value']> {
  getBrowserOwner();
  if (!browserPipeline) return null as MediaInspectionResult<TKind>['value'];
  const ticket = await browserPipeline.inspect({
    kind,
    entity,
    generationId: `${kind}:${entity.id}:${entity.lastModified}:${entity.size}`,
    origin,
    priority: 'interactive',
    signal
  });
  return (await ticket.result).value;
}

export function loadInspectedTrackMetadata(
  entity: MediaEntity | null,
  origin: MediaInspectionOrigin = 'playback',
  signal?: AbortSignal
): Promise<TrackMetadata | null> {
  if (!entity) return Promise.resolve(null);
  return inspectOnDemand('catalog-metadata', entity, origin, signal);
}

export function loadInspectedEmbeddedArtwork(
  entity: MediaEntity | null,
  origin: MediaInspectionOrigin = 'artwork',
  signal?: AbortSignal
): Promise<EmbeddedStreamArtwork | null> {
  if (!entity || entity.kind !== 'stream') return Promise.resolve(null);
  const key = `artwork:${entity.id}:${entity.format}:${entity.lastModified}:${entity.size}`;
  return cacheOnDemand(key, () => inspectOnDemand('embedded-artwork', entity, origin, signal));
}

export async function loadInspectedTrackArtwork(
  entity: MediaEntity | null,
  origin: MediaInspectionOrigin = 'artwork',
  signal?: AbortSignal
): Promise<LoadedStreamArtwork | null> {
  const artwork = await loadInspectedEmbeddedArtwork(entity, origin, signal);
  return artwork ? createLoadedStreamArtwork(artwork) : null;
}

export function loadInspectedTrackLyrics(
  entity: MediaEntity | null,
  origin: MediaInspectionOrigin = 'artwork',
  signal?: AbortSignal
): Promise<LoadedLyrics | null> {
  if (!entity || entity.kind !== 'stream') return Promise.resolve(null);
  const key = `lyrics:${entity.id}:${entity.format}:${entity.lastModified}:${entity.size}`;
  return cacheOnDemand(key, async () => {
    const inspected = await inspectOnDemand('embedded-lyrics', entity, origin, signal);
    return inspected
      ? { raw: inspected.raw, source: inspected.source as LoadedLyrics['source'], lines: [...inspected.lines] }
      : null;
  });
}

export function loadInspectedMetadataDocument(
  entity: MediaEntity,
  signal?: AbortSignal
): Promise<MetadataDocument | null> {
  return inspectOnDemand('metadata-document', entity, 'tool', signal);
}

export async function inspectMetadataDocumentFile(
  file: File,
  format: string,
  signal?: AbortSignal
): Promise<MetadataDocument> {
  if (typeof window === 'undefined') return readMetadataDocument(file, format, signal);
  const id = `inspection:${new BrowserId(window.crypto).create()}`;
  const entity: MediaEntity = {
    id,
    path: file.name,
    name: file.name,
    format,
    kind: 'stream',
    size: file.size,
    lastModified: file.lastModified
  };
  mediaSources.registerFile(id, file);
  try {
    const document = await loadInspectedMetadataDocument(entity, signal);
    if (!document) throw new Error(`Metadata inspection did not produce a document for ${file.name}.`);
    return document;
  } finally {
    mediaSources.remove(id);
  }
}

export function inspectCatalogMetadata(
  entities: readonly MediaEntity[],
  options: CatalogMetadataInspectionOptions
): CatalogMetadataInspectionBatch {
  const owner = getBrowserOwner();
  if (owner) return owner.inspect(entities, options);
  return {
    generationId: 'catalog-metadata-unavailable',
    settled: Promise.resolve(),
    cancel: () => false
  };
}

export async function disposeCatalogMetadataInspection(): Promise<void> {
  const owner = browserOwner;
  browserOwner = undefined;
  browserPipeline = undefined;
  onDemandResults.clear();
  await owner?.dispose();
}
