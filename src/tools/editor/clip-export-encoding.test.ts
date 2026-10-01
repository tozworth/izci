import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CLIP_EXPORT_OPTIONS } from './clip-export-options';
import type { EditorExportRequest, EditorExportResponse } from './clip-export-protocol';
import { EMPTY_TAGS } from './tag-writer';

describe('actual worker WAV encoding', () => {
  let deliver: (message: EditorExportResponse) => void;
  const scope = {
    onmessage: null as ((event: MessageEvent<EditorExportRequest>) => void) | null,
    postMessage: (message: EditorExportResponse) => deliver(message)
  };
  beforeAll(async () => { vi.stubGlobal('self', scope); await import('./clip-export.worker'); });
  afterAll(() => vi.unstubAllGlobals());

  function send(request: EditorExportRequest): Promise<EditorExportResponse> {
    return new Promise((resolve, reject) => {
      deliver = (response) => response.type === 'error' ? reject(new Error(response.message)) : resolve(response);
      scope.onmessage?.({ data: request } as MessageEvent<EditorExportRequest>);
    });
  }

  function riffChunks(buffer: ArrayBuffer): Map<string, { offset: number; length: number }> {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const chunks = new Map<string, { offset: number; length: number }>();
    for (let start = 12; start + 8 <= bytes.length;) {
      const name = new TextDecoder().decode(bytes.subarray(start, start + 4));
      const length = view.getUint32(start + 4, true);
      chunks.set(name, { offset: start + 8, length });
      start += 8 + length + (length % 2);
    }
    return chunks;
  }

  for (const bitDepth of [16, 24, 32] as const) {
    it(`preserves PCM and metadata over multiple chunks at ${bitDepth} bits`, async () => {
      expect(await send({ type: 'start', options: { ...DEFAULT_CLIP_EXPORT_OPTIONS, format: 'wav', bitDepth },
        tags: { ...EMPTY_TAGS, title: 'Chunked export' }, artwork: null, sampleRate: 48_000, numberOfChannels: 2
      })).toEqual({ type: 'ready' });
      for (let chunk = 0; chunk < 3; chunk += 1) {
        const data = Float32Array.from({ length: 400 }, (_, i) => i % 2 === 0 ? 0.5 : -0.25);
        expect(await send({ type: 'chunk', data: data.buffer, timestamp: chunk * 200 / 48_000 })).toEqual({ type: 'ready' });
      }
      const result = await send({ type: 'finish' });
      if (result.type !== 'complete') throw new Error('Expected encoded WAV');
      const chunks = riffChunks(result.buffer);
      const format = chunks.get('fmt ')!;
      const data = chunks.get('data')!;
      const view = new DataView(result.buffer);
      expect(view.getUint16(format.offset + 2, true)).toBe(2);
      expect(view.getUint32(format.offset + 4, true)).toBe(48_000);
      expect(view.getUint16(format.offset + 14, true)).toBe(bitDepth);
      expect(data.length).toBe(600 * 2 * bitDepth / 8);
      expect(new TextDecoder().decode(result.buffer)).toContain('Chunked export');
      if (bitDepth === 16) {
        expect(view.getInt16(data.offset, true) / 32768).toBeCloseTo(0.5, 4);
        expect(view.getInt16(data.offset + 2, true) / 32768).toBeCloseTo(-0.25, 4);
        expect(view.getInt16(data.offset + data.length - 2, true) / 32768).toBeCloseTo(-0.25, 4);
      } else if (bitDepth === 24) {
        const bytes = new Uint8Array(result.buffer);
        const read = (offset: number) => ((bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16) << 8 >> 8) / 8388608;
        expect(read(data.offset)).toBeCloseTo(0.5, 6);
        expect(read(data.offset + data.length - 3)).toBeCloseTo(-0.25, 6);
      } else if (bitDepth === 32) {
        expect(view.getFloat32(data.offset, true)).toBe(0.5);
        expect(view.getFloat32(data.offset + 4, true)).toBe(-0.25);
        expect(view.getFloat32(data.offset + data.length - 4, true)).toBe(-0.25);
      }
    });
  }
});
