import { describe, expect, it } from 'vitest';
import { createAudioDocument, sliceAudioDocument } from './audio-document';
import { retainEditorHistory } from './editor-history';
import { testAudioBuffer } from './test-audio-buffer';

describe('editor history PCM budget', () => {
  it('retains shared source edits without charging PCM again', () => {
    const current = createAudioDocument(testAudioBuffer([[1, 2, 3, 4, 5]]));
    const entries = Array.from({ length: 20 }, (_, id) => ({ id, audio: sliceAudioDocument(current, 0, 0.3) }));
    expect(retainEditorHistory(entries, current, false, 0).map((entry) => entry.id)).toEqual(Array.from({ length: 12 }, (_, i) => i + 8));
  });

  it('retains only the nearest undo/redo versions when effects exceed the budget', () => {
    const current = createAudioDocument(testAudioBuffer([[0, 0, 0, 0]]));
    const entries = [1, 2, 3, 4].map((id) => ({ id, audio: createAudioDocument(testAudioBuffer([[id, id, id, id]])) }));
    expect(retainEditorHistory(entries, current, false, 32).map((entry) => entry.id)).toEqual([3, 4]);
    expect(retainEditorHistory(entries, current, true, 32).map((entry) => entry.id)).toEqual([1, 2]);
    expect(retainEditorHistory(entries, current, false, 15)).toEqual([]);
  });
});
