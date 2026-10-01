import type { AudioDocument } from './audio-document';
import { EDITOR_PCM_CHUNK_FRAMES, readDocumentPcm } from './audio-document-pcm';
import { ClipExportUnavailableError, type ClipExportOptions } from './clip-export-options';
import type { EditorExportRequest, EditorExportResponse } from './clip-export-protocol';
import type { EditableTags } from './tag-writer';

/** Encoding and resampling run off the UI thread; PCM is supplied on demand. */
export async function encodeAudioExport(
  document: AudioDocument,
  options: ClipExportOptions,
  tags: EditableTags,
  artwork: Blob | null,
  signal?: AbortSignal
): Promise<Blob> {
  signal?.throwIfAborted();
  const worker = new Worker(new URL('./clip-export.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<Blob>((resolve, reject) => {
    let offset = 0;
    let settled = false;
    const finish = () => { settled = true; worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(signal?.reason ?? new DOMException('Audio export cancelled.', 'AbortError')); };
    const post = (request: EditorExportRequest, transfer: Transferable[] = []) => worker.postMessage(request, transfer);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { finish(); reject(new Error('The audio encoder failed to start.')); };
    worker.onmessage = (event: MessageEvent<EditorExportResponse>) => {
      if (settled) return;
      const message = event.data;
      try {
        if (message.type === 'ready') {
          if (offset >= Math.max(1, document.length)) { post({ type: 'finish' }); return; }
          const frames = Math.min(EDITOR_PCM_CHUNK_FRAMES, Math.max(1, document.length) - offset);
          const data = document.length === 0 ? new Float32Array(document.numberOfChannels) : readDocumentPcm(document, offset, frames);
          post({ type: 'chunk', data: data.buffer, timestamp: offset / document.sampleRate }, [data.buffer]);
          offset += frames;
        } else if (message.type === 'complete') {
          finish(); resolve(new Blob([message.buffer], { type: message.mimeType }));
        } else if (message.type === 'error') {
          finish(); reject(message.unavailable ? new ClipExportUnavailableError(options.format) : new Error(message.message));
        }
      } catch (error) { finish(); reject(error); }
    };
    try {
      post({ type: 'start', options, tags, artwork, sampleRate: document.sampleRate, numberOfChannels: document.numberOfChannels });
    } catch (error) { finish(); reject(error); }
  });
}
