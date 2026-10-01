import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioDocument, replaceAudioDocumentRange } from './audio-document';
import { EDITOR_PCM_CHUNK_FRAMES } from './audio-document-pcm';
import { encodeAudioExport } from './clip-export';
import { DEFAULT_CLIP_EXPORT_OPTIONS } from './clip-export-options';
import type { EditorExportRequest, EditorExportResponse } from './clip-export-protocol';
import { EMPTY_TAGS } from './tag-writer';
import { testAudioBuffer } from './test-audio-buffer';

describe('editor worker export handoff', () => {
  let worker: FakeWorker;
  class FakeWorker {
    onmessage: ((event: MessageEvent<EditorExportResponse>) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage = vi.fn<(message: EditorExportRequest, transfer: Transferable[]) => void>();
    terminate = vi.fn();
    constructor() { worker = this; }
    respond(message: EditorExportResponse) { this.onmessage?.({ data: message } as MessageEvent<EditorExportResponse>); }
  }
  beforeEach(() => vi.stubGlobal('Worker', FakeWorker));
  afterEach(() => vi.unstubAllGlobals());

  it('copies one bounded PCM chunk per encoder credit, across edit joins', async () => {
    const buffer = testAudioBuffer([Array.from({ length: EDITOR_PCM_CHUNK_FRAMES * 3 }, (_, i) => i)], 48_000);
    const original = createAudioDocument(buffer);
    const document = replaceAudioDocumentRange(original, 0.1, 0.2, null);
    const pending = encodeAudioExport(document, DEFAULT_CLIP_EXPORT_OPTIONS, EMPTY_TAGS, null);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.respond({ type: 'ready' });
    const chunk = worker.postMessage.mock.calls.at(-1)![0];
    expect(chunk.type).toBe('chunk');
    if (chunk.type !== 'chunk') throw new Error('Expected PCM');
    const samples = new Float32Array(chunk.data);
    expect(samples).toHaveLength(EDITOR_PCM_CHUNK_FRAMES);
    expect([...samples.slice(4798, 4802)]).toEqual([4798, 4799, 9600, 9601]);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    worker.respond({ type: 'ready' }); worker.respond({ type: 'ready' }); worker.respond({ type: 'ready' });
    expect(worker.postMessage.mock.calls.at(-1)![0]).toEqual({ type: 'finish' });
    worker.respond({ type: 'complete', buffer: new Uint8Array([1, 2, 3]).buffer, mimeType: 'audio/wav' });
    const result = await pending;
    expect(result.type).toBe('audio/wav'); expect(result.size).toBe(3);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates immediately on cancellation and preserves unavailable encoder errors', async () => {
    const document = createAudioDocument(testAudioBuffer([[1, 2, 3]]));
    const controller = new AbortController();
    const cancelled = encodeAudioExport(document, DEFAULT_CLIP_EXPORT_OPTIONS, EMPTY_TAGS, null, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    const failed = encodeAudioExport(document, { ...DEFAULT_CLIP_EXPORT_OPTIONS, format: 'mp3' }, EMPTY_TAGS, null);
    worker.respond({ type: 'error', message: 'Unavailable', unavailable: true });
    await expect(failed).rejects.toMatchObject({ format: 'mp3' });
  });
});
