import type { MediaEntity } from '$lib/contracts/catalog';
import {
  materializeMediaEntityResult as acquireMediaLeaseResult,
  mediaSources,
  type MediaMaterializationResult,
  type MediaMaterializationLease
} from '$lib/media/media-source';
import { logWarning } from '$lib/logging/api';

export type MediaMaterializationPurpose = 'file-read' | 'media-element';

const browserObjectUrls = {
  create: (blob: Blob) => URL.createObjectURL(blob),
  revoke: (url: string) => URL.revokeObjectURL(url)
};

/** Page-facing source adapter. The returned lease owns any object URL it created. */
export async function materializeMediaEntity(
  entity: MediaEntity,
  prompt = false,
  purpose: MediaMaterializationPurpose = 'file-read'
): Promise<MediaMaterializationLease | null> {
  const result = await materializeMediaEntityResult(entity, prompt, purpose);
  return result.status === 'ready' ? result.lease : null;
}

/** Preserves classified materialization failure through the page/store boundary. */
export async function materializeMediaEntityResult(
  entity: MediaEntity,
  prompt = false,
  purpose: MediaMaterializationPurpose = 'file-read'
): Promise<MediaMaterializationResult> {
  const result = await acquireMediaLeaseResult(entity, mediaSources.get(entity.id), {
    prompt,
    purpose,
    objectUrls: browserObjectUrls
  });
  if (result.status === 'failure') {
    logWarning('files', 'Media source could not be materialized', {
      id: entity.id,
      prompt,
      purpose,
      reason: result.reason
    });
  }
  return result;
}

export async function withMediaFile<T>(
  entity: MediaEntity,
  operation: (file: File) => T | Promise<T>,
  prompt = false
): Promise<T | null> {
  const lease = await materializeMediaEntity(entity, prompt, 'file-read');
  if (!lease) return null;
  try {
    return await operation(lease.file);
  } finally {
    lease.release();
  }
}
