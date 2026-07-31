import type { MediaFileFingerprint } from './types';

const SAMPLE_BYTES = 64 * 1024;

function fnv1a(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export async function fingerprintFile(file: File): Promise<MediaFileFingerprint> {
  const first = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
  const tailStart = Math.max(first.byteLength, file.size - SAMPLE_BYTES);
  const last = tailStart < file.size
    ? new Uint8Array(await file.slice(tailStart).arrayBuffer())
    : new Uint8Array();
  const firstHash = fnv1a(first, 0x811c9dc5);
  const finalHash = fnv1a(last, firstHash ^ file.size);
  return Object.freeze({
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    sampleHash: finalHash.toString(16).padStart(8, '0')
  });
}

export function fingerprintsMatch(
  first: MediaFileFingerprint,
  second: MediaFileFingerprint
): boolean {
  return first.name === second.name
    && first.size === second.size
    && first.lastModified === second.lastModified
    && first.sampleHash === second.sampleHash;
}
