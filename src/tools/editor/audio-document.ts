import { yieldEditorTask } from './editor-task';

export interface AudioSegment {
  readonly buffer: AudioBuffer;
  readonly start: number;
  readonly end: number;
}

/** Immutable, sample-aligned edit list. History/clipboard share PCM with the source. */
export interface AudioDocument {
  readonly segments: readonly AudioSegment[];
  readonly offsets: readonly number[];
  readonly length: number;
  readonly duration: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
}

function assemble(template: Pick<AudioDocument, 'sampleRate' | 'numberOfChannels'>, pieces: readonly AudioSegment[]): AudioDocument {
  const segments: AudioSegment[] = [];
  for (const piece of pieces) {
    if (piece.end <= piece.start) continue;
    const last = segments.at(-1);
    if (last?.buffer === piece.buffer && last.end === piece.start) {
      segments[segments.length - 1] = { buffer: last.buffer, start: last.start, end: piece.end };
    } else segments.push(piece);
  }
  const offsets: number[] = [];
  let length = 0;
  for (const segment of segments) {
    offsets.push(length);
    length += segment.end - segment.start;
  }
  return { ...template, segments, offsets, length, duration: length / template.sampleRate };
}

export function createAudioDocument(buffer: AudioBuffer): AudioDocument {
  return assemble({ sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels }, [
    { buffer, start: 0, end: buffer.length }
  ]);
}

export function documentFrameAt(document: AudioDocument, seconds: number): number {
  return Math.min(document.length, Math.max(0, Math.round(seconds * document.sampleRate)));
}

export function documentSegmentAt(document: AudioDocument, frame: number): number {
  let low = 0;
  let high = document.offsets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (document.offsets[middle] <= frame) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function sliceFrames(document: AudioDocument, start: number, end: number): AudioSegment[] {
  const pieces: AudioSegment[] = [];
  for (let index = documentSegmentAt(document, start); index < document.segments.length; index += 1) {
    const segment = document.segments[index];
    const offset = document.offsets[index];
    if (offset >= end) break;
    const readStart = Math.max(start, offset) - offset + segment.start;
    const readEnd = Math.min(end - offset + segment.start, segment.end);
    if (readEnd > readStart) pieces.push({ buffer: segment.buffer, start: readStart, end: readEnd });
  }
  return pieces;
}

export function sliceAudioDocument(document: AudioDocument, start: number, end: number): AudioDocument {
  const first = documentFrameAt(document, start);
  const last = Math.max(first, documentFrameAt(document, end));
  return assemble(document, sliceFrames(document, first, last));
}

export function replaceAudioDocumentRange(
  document: AudioDocument,
  start: number,
  end: number,
  replacement: AudioDocument | null
): AudioDocument {
  if (replacement && (replacement.sampleRate !== document.sampleRate || replacement.numberOfChannels !== document.numberOfChannels)) {
    throw new Error('Pasted audio must use the same sample rate and channel layout.');
  }
  const first = documentFrameAt(document, start);
  const last = Math.max(first, documentFrameAt(document, end));
  return assemble(document, [
    ...sliceFrames(document, 0, first),
    ...(replacement?.segments ?? []),
    ...sliceFrames(document, last, document.length)
  ]);
}

/** Only effects/export need contiguous PCM; ordinary edits and playback never do. */
export async function materializeAudioDocument(document: AudioDocument, signal?: AbortSignal): Promise<AudioBuffer> {
  signal?.throwIfAborted();
  const only = document.segments[0];
  if (document.segments.length === 1 && only.start === 0 && only.end === only.buffer.length) return only.buffer;
  await yieldEditorTask(signal);
  const output = new AudioBuffer({
    length: Math.max(1, document.length),
    numberOfChannels: document.numberOfChannels,
    sampleRate: document.sampleRate
  });
  let deadline = performance.now() + 4;
  for (let index = 0; index < document.segments.length; index += 1) {
    const segment = document.segments[index];
    for (let channel = 0; channel < document.numberOfChannels; channel += 1) {
      const input = segment.buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      for (let frame = segment.start; frame < segment.end; frame += 65_536) {
        signal?.throwIfAborted();
        const end = Math.min(segment.end, frame + 65_536);
        target.set(input.subarray(frame, end), document.offsets[index] + frame - segment.start);
        if (performance.now() >= deadline) {
          await yieldEditorTask(signal);
          deadline = performance.now() + 4;
        }
      }
    }
  }
  return output;
}
