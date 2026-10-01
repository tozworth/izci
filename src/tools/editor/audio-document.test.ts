import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAudioDocument, materializeAudioDocument, replaceAudioDocumentRange, sliceAudioDocument
} from './audio-document';
import { readDocumentPcm } from './audio-document-pcm';
import { TestAudioBuffer, testAudioBuffer } from './test-audio-buffer';

afterEach(() => vi.unstubAllGlobals());

describe('shared editor audio', () => {
  it('opens, cuts, copies and pastes without allocating or mutating source PCM', async () => {
    const buffer = testAudioBuffer([[0, 1, 2, 3, 4, 5], [10, 11, 12, 13, 14, 15]]);
    const allocation = vi.fn();
    vi.stubGlobal('AudioBuffer', allocation);
    const original = createAudioDocument(buffer);
    const copy = sliceAudioDocument(original, 0.1, 0.3);
    const cut = replaceAudioDocumentRange(original, 0.2, 0.4, null);
    const pasted = replaceAudioDocumentRange(cut, 0.1, 0.2, copy);
    expect(allocation).not.toHaveBeenCalled();
    expect(copy.segments[0].buffer).toBe(buffer);
    expect(cut.segments.every((segment) => segment.buffer === buffer)).toBe(true);
    expect([...readDocumentPcm(pasted, 0, pasted.length)]).toEqual([0, 10, 1, 11, 2, 12, 4, 14, 5, 15]);
    expect([...buffer.getChannelData(0)]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await materializeAudioDocument(original)).toBe(buffer);
  });

  it('materializes multi-source joins and trim boundaries exactly', async () => {
    vi.stubGlobal('AudioBuffer', TestAudioBuffer);
    const source = createAudioDocument(testAudioBuffer([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]));
    const wet = createAudioDocument(testAudioBuffer([[20, 30], [80, 90]]));
    const replaced = replaceAudioDocumentRange(source, 0.2, 0.4, wet);
    const trimmed = sliceAudioDocument(replaced, 0.1, 0.4);
    const result = await materializeAudioDocument(trimmed);
    expect([...result.getChannelData(0)]).toEqual([2, 20, 30]);
    expect([...result.getChannelData(1)]).toEqual([7, 80, 90]);
    expect([...readDocumentPcm(replaced, 1, 3)]).toEqual([2, 7, 20, 80, 30, 90]);
    expect(replaced.duration).toBe(0.5);
  });

  it('coalesces adjacent source slices and handles delete-all followed by paste', () => {
    const original = createAudioDocument(testAudioBuffer([[1, 2, 3, 4]]));
    const restored = replaceAudioDocumentRange(original, 0.1, 0.2, sliceAudioDocument(original, 0.1, 0.2));
    expect(restored.segments).toHaveLength(1);
    const empty = replaceAudioDocumentRange(original, 0, original.duration, null);
    expect(empty.length).toBe(0);
    expect(empty.segments).toEqual([]);
    const pasted = replaceAudioDocumentRange(empty, 0, 0, original);
    expect(pasted.length).toBe(4);
    expect([...readDocumentPcm(pasted, 0, 4)]).toEqual([1, 2, 3, 4]);
  });

  it('matches sample-array editing over many fragmented operations and retains old snapshots', () => {
    const original = createAudioDocument(testAudioBuffer([Array.from({ length: 100 }, (_, i) => i)], 100));
    let document = original;
    let expected = Array.from({ length: 100 }, (_, i) => i);
    let seed = 7;
    const random = (max: number) => { seed = (seed * 16807) % 2147483647; return seed % max; };
    for (let edit = 0; edit < 150; edit += 1) {
      const start = random(expected.length + 1);
      const end = start + random(expected.length - start + 1);
      const copyStart = random(99);
      const length = 1 + random(100 - copyStart);
      const inserted = sliceAudioDocument(original, copyStart / 100, (copyStart + length) / 100);
      document = replaceAudioDocumentRange(document, start / 100, end / 100, edit % 3 ? inserted : null);
      expected.splice(start, end - start, ...(edit % 3 ? Array.from({ length }, (_, i) => i + copyStart) : []));
      expect([...readDocumentPcm(document, 0, document.length)]).toEqual(expected);
    }
    expect([...readDocumentPcm(original, 0, 100)]).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it('rejects incompatible replacement audio and cancelled materialization', async () => {
    const original = createAudioDocument(testAudioBuffer([[1, 2, 3]]));
    expect(() => replaceAudioDocumentRange(original, 0, 0, createAudioDocument(testAudioBuffer([[1]], 20)))).toThrow('sample rate');
    const controller = new AbortController();
    controller.abort();
    await expect(materializeAudioDocument(original, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
