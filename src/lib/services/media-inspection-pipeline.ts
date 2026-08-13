import type { MediaEntity } from '$lib/contracts/catalog';
import type { TrackMetadata } from '$lib/contracts/media-metadata';
import type { MediaMaterializationLease } from '$lib/media/media-source';
import {
  BoundedInspectionWorkQueue,
  type BoundedInspectionWorkQueueOptions,
  type InspectionPriority,
  type InspectionWorkQueueCounts,
  type InspectionWorkTicket
} from '$lib/media/inspection-work-queue';
import { DomainError } from '$lib/runtime/errors';
import type { MetadataDocument } from '$lib/services/media-metadata/types';

export type MediaInspectionKind =
  | 'catalog-metadata'
  | 'embedded-artwork'
  | 'embedded-lyrics'
  | 'metadata-document';

export type MediaInspectionOrigin =
  | 'artwork'
  | 'folder-scan'
  | 'hydration'
  | 'import'
  | 'playback'
  | 'tool';

export interface InspectedArtwork {
  readonly blob: Blob;
  readonly width?: number;
  readonly height?: number;
}

export interface InspectedLyrics {
  readonly raw: string;
  readonly source: string;
}

export interface MediaInspectionResultMap {
  readonly 'catalog-metadata': TrackMetadata | null;
  readonly 'embedded-artwork': InspectedArtwork | null;
  readonly 'embedded-lyrics': InspectedLyrics | null;
  readonly 'metadata-document': MetadataDocument | null;
}

export interface MediaInspectionRequest<TKind extends MediaInspectionKind = MediaInspectionKind> {
  readonly kind: TKind;
  readonly entity: MediaEntity;
  readonly generationId: string;
  readonly origin: MediaInspectionOrigin;
  readonly priority?: InspectionPriority;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface MediaInspectionContext {
  readonly entity: MediaEntity;
  readonly file: File;
  readonly signal: AbortSignal;
  readonly generationId: string;
  readonly origin: MediaInspectionOrigin;
}

export type MediaInspectionHandler<TValue> = (
  context: MediaInspectionContext
) => TValue | Promise<TValue>;

export type MediaInspectionHandlers = {
  readonly [TKind in MediaInspectionKind]: MediaInspectionHandler<MediaInspectionResultMap[TKind]>;
};

export interface MediaInspectionResult<TKind extends MediaInspectionKind> {
  readonly kind: TKind;
  readonly entityId: string;
  readonly generationId: string;
  readonly sourceRevision: string;
  readonly value: MediaInspectionResultMap[TKind];
}

export interface MediaInspectionTicket<TKind extends MediaInspectionKind> {
  readonly result: Promise<MediaInspectionResult<TKind>>;
  cancel(): boolean;
}

export interface MediaInspectionPipelineOptions extends BoundedInspectionWorkQueueOptions {
  readonly handlers: MediaInspectionHandlers;
  readonly materialize: (entity: MediaEntity) => Promise<MediaMaterializationLease | null>;
  readonly defaultTimeoutMs?: number;
}

function normalizeRevisionPart(value: string): string {
  return value.replaceAll('\\', '/').trim().toLocaleLowerCase();
}

export function getMediaSourceRevision(entity: MediaEntity): string {
  return JSON.stringify([
    entity.id,
    normalizeRevisionPart(entity.path),
    normalizeRevisionPart(entity.format),
    entity.kind,
    entity.size,
    entity.lastModified,
    entity.subsong ?? null
  ]);
}

function inspectionKey(kind: MediaInspectionKind, entityId: string): string {
  return `${kind}:${entityId}`;
}

export class MediaInspectionPipeline {
  readonly #queue: BoundedInspectionWorkQueue<string>;
  readonly #handlers: MediaInspectionHandlers;
  readonly #materialize: MediaInspectionPipelineOptions['materialize'];
  readonly #defaultTimeoutMs: number | undefined;

  constructor(options: MediaInspectionPipelineOptions) {
    this.#handlers = options.handlers;
    this.#materialize = options.materialize;
    this.#defaultTimeoutMs = options.defaultTimeoutMs;
    this.#queue = new BoundedInspectionWorkQueue({
      maxConcurrency: options.maxConcurrency,
      maxBackgroundConcurrency: options.maxBackgroundConcurrency,
      clock: options.clock,
      abortControllers: options.abortControllers
    });
  }

  get counts(): InspectionWorkQueueCounts {
    return this.#queue.counts;
  }

  get disposed(): boolean {
    return this.#queue.disposed;
  }

  inspect<TKind extends MediaInspectionKind>(
    request: MediaInspectionRequest<TKind>
  ): MediaInspectionTicket<TKind> {
    const sourceRevision = getMediaSourceRevision(request.entity);
    const ticket: InspectionWorkTicket<MediaInspectionResult<TKind>> = this.#queue.enqueue(
      async ({ signal }) => {
        const lease = await this.#materialize(request.entity);
        if (!lease) {
          throw new DomainError({
            category: 'unavailable',
            code: 'media-inspection.source-unavailable',
            operation: `inspect ${request.kind}`,
            retryable: true,
            message: `The source for ${request.entity.name} is unavailable.`
          });
        }
        try {
          if (signal.aborted) {
            throw new DomainError({
              category: 'cancellation',
              code: 'media-inspection.cancelled',
              operation: `inspect ${request.kind}`,
              retryable: false
            });
          }
          const handler = this.#handlers[request.kind] as MediaInspectionHandler<
            MediaInspectionResultMap[TKind]
          >;
          const value = await handler({
            entity: lease.entity,
            file: lease.file,
            signal,
            generationId: request.generationId,
            origin: request.origin
          });
          return {
            kind: request.kind,
            entityId: request.entity.id,
            generationId: request.generationId,
            sourceRevision,
            value
          };
        } finally {
          lease.release();
        }
      },
      {
        key: inspectionKey(request.kind, request.entity.id),
        priority: request.priority ?? (request.origin === 'playback' || request.origin === 'tool'
          ? 'interactive'
          : 'background'),
        signal: request.signal,
        timeoutMs: request.timeoutMs ?? this.#defaultTimeoutMs
      }
    );
    return ticket;
  }

  dispose(): Promise<void> {
    return this.#queue.dispose();
  }
}
