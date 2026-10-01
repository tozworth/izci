import { documentSegmentAt, type AudioDocument } from './audio-document';

export const EDITOR_PCM_CHUNK_FRAMES = 16_384;

/** A bounded interleaved copy across source/edit joins for worker handoff. */
export function readDocumentPcm(document: AudioDocument, start: number, frames: number): Float32Array<ArrayBuffer> {
  const length = Math.max(0, Math.min(frames, document.length - start));
  const data = new Float32Array(length * document.numberOfChannels);
  const last = start + length;
  for (let index = documentSegmentAt(document, start); index < document.segments.length; index += 1) {
    const segment = document.segments[index];
    const offset = document.offsets[index];
    if (offset >= last) break;
    const firstFrame = Math.max(start, offset);
    const lastFrame = Math.min(last, offset + segment.end - segment.start);
    for (let channel = 0; channel < document.numberOfChannels; channel += 1) {
      const samples = segment.buffer.getChannelData(channel);
      for (let frame = firstFrame; frame < lastFrame; frame += 1) {
        data[(frame - start) * document.numberOfChannels + channel] = samples[segment.start + frame - offset];
      }
    }
  }
  return data;
}
