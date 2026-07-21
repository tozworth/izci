import { STEM_PAYLOAD } from './payload';
import { STEM_PIPELINE_VERSION, STEM_RESULT_SCHEMA_VERSION } from './types';
import type { PlaylistItem } from '$lib/types';

export function createStemSourceQuickKey(
  track: Pick<PlaylistItem, 'id' | 'path' | 'name' | 'size' | 'lastModified'>
): string {
  return `${track.path ?? track.id}\u0000${track.name}\u0000${track.size}\u0000${track.lastModified}`;
}

export async function digestBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function createStemResultKey(sourceDigest: string): Promise<string> {
  const identity = [
    sourceDigest,
    STEM_PAYLOAD.modelSha256,
    STEM_PAYLOAD.runtimeSha256,
    STEM_PIPELINE_VERSION,
    'decode-44100-stereo',
    'pcm-wav-f32le-stereo',
    String(STEM_RESULT_SCHEMA_VERSION)
  ].join('\n');
  return digestBytes(new TextEncoder().encode(identity).buffer);
}
