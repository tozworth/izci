import { validateQueueRequestId } from './queue-commands';

/**
 * Svelte-side boundary for owner ingest requests.
 *
 * Ingest is the file-access entry point: the document thread passes genuine
 * `File` objects (structured-cloned into the owner worker) plus parallel
 * genuine File System Access handles when the picker provided them. Plain
 * `File` batches become `ephemeral` sources (non-restorable); handle-backed
 * batches become `browser_handle` sources (restorable via capabilities).
 * The worker stages capability keys, requires the `require_playable_header`
 * probe, commits the SQL reference, and completes handles — never
 * synthesizing handles or persisting blobs/URLs.
 *
 * This module pins the request shape and batch budgets before any worker
 * file exists; resolution/completion/GC belong to the future capabilities +
 * owner slice. Nothing here touches handles, IDB, or SQL.
 */

export interface CoreIngestRequest {
  files: File[];
  /** Parallel to `files` when the picker provided handles, else empty. */
  handles: unknown[];
  open: boolean;
  request: string;
}

export const INGEST_MAX_FILES = 10_000;
export const INGEST_MAX_FILE_BYTES = 64 * 1024 * 1024;

function isFile(value: unknown): value is File {
  return (
    typeof File !== 'undefined' &&
    value instanceof File &&
    typeof (value as File).name === 'string'
  );
}

/** Validate an ingest request before posting it to the owner worker. */
export function validateIngestRequest(input: CoreIngestRequest): void {
  if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > INGEST_MAX_FILES) {
    throw new Error(`Invalid ingest files: expected 1..${INGEST_MAX_FILES} files`);
  }
  for (const file of input.files) {
    if (!isFile(file)) throw new Error('Invalid ingest file: expected a genuine File');
    if (file.size > INGEST_MAX_FILE_BYTES) {
      throw new Error(`Invalid ingest file size: ${file.name} exceeds 64 MiB module cap`);
    }
  }
  if (!Array.isArray(input.handles) || (input.handles.length !== 0 && input.handles.length !== input.files.length)) {
    throw new Error('Invalid ingest handles: expected empty or one per file');
  }
  for (const handle of input.handles) {
    if (typeof handle !== 'object' || handle === null) {
      throw new Error('Invalid ingest handle: expected a genuine FileSystemHandle object');
    }
  }
  if (typeof input.open !== 'boolean') {
    throw new Error('Invalid ingest open: expected boolean');
  }
  validateQueueRequestId(input.request);
}

/** Build a validated ingest request for the owner-worker `ingest` channel. */
export function buildIngestRequest(
  files: File[],
  handles: unknown[] = [],
  open = true,
  request?: string
): CoreIngestRequest {
  const input: CoreIngestRequest = {
    files: [...files],
    handles: [...handles],
    open,
    request: request ?? `${crypto.randomUUID()}/ingest`
  };
  validateIngestRequest(input);
  return input;
}
