/**
 * Svelte-side boundary for visual rendition requests.
 *
 * Artwork and image viewing go through bounded rendition jobs (shared Rust
 * rendering, separate IDB rendition cache); no encoded originals enter
 * queue/catalog records and no payloads cross the music transport. This
 * module pins the `image`/`artwork` request shape used by the future owner
 * worker when running `WebImageJob` renditions. Cache lookup, eviction, and
 * viewer navigation belong to later slices; nothing here decodes or stores.
 *
 * Shapes mirror `libzci/consumers/crude-pwa/src/image-job.ts`
 * `ImageJobRequest` and the Rust `rendition::Spec` (`max_edge 1..2048`).
 */

export type CoreRenditionKind = 'image' | 'artwork';

export interface CoreRenditionRequest {
  kind: CoreRenditionKind;
  spec: {
    max_edge: number;
  };
}

export const RENDITION_DEFAULT_EDGE = 512;
export const RENDITION_MIN_EDGE = 1;
export const RENDITION_MAX_EDGE = 2_048;

/** Default artwork/image rendition request. */
export function defaultRenditionRequest(kind: CoreRenditionKind = 'artwork'): CoreRenditionRequest {
  if (kind !== 'image' && kind !== 'artwork') throw new Error(`Invalid rendition kind: ${String(kind)}`);
  return { kind, spec: { max_edge: RENDITION_DEFAULT_EDGE } };
}

/** Validate and normalize a rendition request (`max_edge 1..2048`). */
export function buildRenditionRequest(kind: CoreRenditionKind, maxEdge: number): CoreRenditionRequest {
  if (kind !== 'image' && kind !== 'artwork') {
    throw new Error(`Invalid rendition kind: ${String(kind)}`);
  }
  if (!Number.isSafeInteger(maxEdge) || maxEdge < RENDITION_MIN_EDGE || maxEdge > RENDITION_MAX_EDGE) {
    throw new Error(`Invalid rendition max_edge: ${String(maxEdge)}`);
  }
  return { kind, spec: { max_edge: maxEdge } };
}

/** Serialize a rendition request for the owner-worker image channel. */
export function serializeRenditionRequest(request: CoreRenditionRequest): string {
  return JSON.stringify(buildRenditionRequest(request.kind, request.spec.max_edge));
}
