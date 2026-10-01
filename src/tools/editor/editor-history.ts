import type { AudioDocument } from './audio-document';

const MAX_EDIT_HISTORY = 12;
const HISTORY_PCM_BYTES = 128 * 1024 * 1024;

/** Bound retained effect PCM; ordinary segment edits share their buffers for free. */
export function retainEditorHistory<T extends { audio: AudioDocument }>(
  entries: readonly T[],
  current: AudioDocument,
  newestFirst = false,
  maximumBytes = HISTORY_PCM_BYTES
): T[] {
  const buffers = new Set(current.segments.map((segment) => segment.buffer));
  const retained: T[] = [];
  let bytes = 0;
  const candidates = newestFirst ? entries : [...entries].reverse();
  for (const entry of candidates) {
    const additions = new Set(entry.audio.segments.map((segment) => segment.buffer).filter((buffer) => !buffers.has(buffer)));
    const extra = [...additions].reduce((total, buffer) => total + buffer.length * buffer.numberOfChannels * 4, 0);
    if (bytes + extra > maximumBytes || retained.length >= MAX_EDIT_HISTORY) break;
    bytes += extra;
    for (const buffer of additions) buffers.add(buffer);
    retained.push(entry);
  }
  return newestFirst ? retained : retained.reverse();
}
