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
import { loadModuleMetadataFromFile } from '$lib/services/module-metadata';
import {
  MediaInspectionPipeline,
  type MediaInspectionContext,
  type MediaInspectionOrigin,
  type MediaInspectionResult,
  type MediaInspectionTicket
} from '$lib/services/media-inspection-pipeline';
import { loadTrackMetadataFromFile } from '$lib/services/stream-artwork';
import { materializeMediaEntity } from '$lib/stores/playlist-materialization';

const CATALOG_METADATA_TIMEOUT_MS = 15_000;
const MEDIA_DURATION_TIMEOUT_MS = 10_000;
const MAX_INSPECTION_CONCURRENCY = 3;
const MAX_BACKGROUND_INSPECTION_CONCURRENCY = 2;

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
  }): MediaInspectionTicket<'catalog-metadata'>;
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

    const operations = entities.map(async (entity) => {
      try {
        const result = await this.#pipeline.inspect({
          kind: 'catalog-metadata',
          entity,
          generationId,
          origin: options.origin,
          signal: controller.signal,
          timeoutMs: CATALOG_METADATA_TIMEOUT_MS
        }).result;
        if (!controller.signal.aborted) await options.onResult(result);
      } catch (error) {
        if (!(error instanceof InspectionWorkCancelledError)) {
          options.onError?.(error, entity);
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

function getBrowserOwner(): CatalogMetadataInspectionOwner | null {
  if (typeof window === 'undefined') return null;
  if (browserOwner) return browserOwner;

  const abortControllers = new BrowserAbortControllers(window);
  const objectUrls = new BrowserObjectUrls(window);
  const handler = createCatalogMetadataHandler({
    readStream: (file, format) => loadTrackMetadataFromFile(file, format),
    readModule: (entity, file, signal) => loadModuleMetadataFromFile(entity, file, signal),
    readDuration: (file, signal) => readNativeAudioDuration(file, signal, objectUrls)
  });
  const pipeline = new MediaInspectionPipeline({
    maxConcurrency: MAX_INSPECTION_CONCURRENCY,
    maxBackgroundConcurrency: MAX_BACKGROUND_INSPECTION_CONCURRENCY,
    clock: new BrowserClock(window, () => window.Date.now(), () => window.performance.now()),
    abortControllers,
    defaultTimeoutMs: CATALOG_METADATA_TIMEOUT_MS,
    materialize: (entity) => materializeMediaEntity(entity, false, 'file-read'),
    handlers: {
      'catalog-metadata': handler,
      'embedded-artwork': async () => null,
      'embedded-lyrics': async () => null,
      'metadata-document': async () => null
    }
  });
  browserOwner = new CatalogMetadataInspectionOwner(
    pipeline,
    new BrowserId(window.crypto),
    abortControllers
  );
  return browserOwner;
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
  await owner?.dispose();
}
