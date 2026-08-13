import type { MediaEntity } from '$lib/contracts/catalog';
import {
  materializeMediaEntity as acquireMediaLease,
  mediaSources,
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
  const lease = await acquireMediaLease(entity, mediaSources.get(entity.id), {
    prompt,
    purpose,
    objectUrls: browserObjectUrls
  });
  if (!lease) {
    logWarning('files', 'Media source could not be materialized', { id: entity.id, prompt, purpose });
  }
  return lease;
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
