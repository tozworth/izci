import { describe, expect, it } from 'vitest';
import { previewBackendFor, isPreviewableKind, syncLyricsFile } from './lyrics-preview';

describe('Troubadour preview backends', () => {
  it('routes libopenmpt module formats to the module backend', () => {
    expect(previewBackendFor('mod')).toBe('module');
    expect(previewBackendFor('XM')).toBe('module');
    expect(previewBackendFor('s3m')).toBe('module');
    expect(previewBackendFor('it')).toBe('module');
    expect(previewBackendFor('mo3')).toBe('module');
    expect(previewBackendFor('mptm')).toBe('module');
  });

  it('has no backend for Hively modules and routes streams to the audio element', () => {
    expect(previewBackendFor('ahx')).toBeNull();
    expect(previewBackendFor('hvl')).toBeNull();
    expect(previewBackendFor('mp3')).toBe('stream');
    expect(previewBackendFor('flac')).toBe('stream');
    expect(previewBackendFor('txt')).toBe('stream');
  });

  it('accepts only stream and module kinds as previewable', () => {
    expect(isPreviewableKind('stream')).toBe(true);
    expect(isPreviewableKind('module')).toBe(true);
    expect(isPreviewableKind('video')).toBe(false);
    expect(isPreviewableKind(null)).toBe(false);
  });

  it('swaps the preview file whenever the kind changes', () => {
    const calls: Array<[File | null, string | null]> = [];
    const preview = { setFile: (file: File | null, kind: string | null) => calls.push([file, kind]) };
    const stream = new File([], 'a.mp3');
    const module = new File([], 'b.xm');

    let previous = syncLyricsFile(preview, stream, 'stream', null, null);
    previous = syncLyricsFile(preview, module, 'module', previous, 'stream');
    // Same file, same kind: no re-load.
    syncLyricsFile(preview, module, 'module', previous, 'module');

    expect(calls).toEqual([[stream, 'stream'], [module, 'module']]);
  });
});
