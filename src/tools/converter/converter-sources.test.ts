import { describe, expect, it } from 'vitest';
import { registerImportedFile } from '$lib/utils/file-sources';
import { converterSources } from './converter-sources';

describe('converter folder structure', () => {
  it('preserves subfolders for a browser folder drop and omits its root', () => {
    const file = registerImportedFile(new File([], 'track.flac'), { path: 'Music/Artist/Album/track.flac' });
    expect(converterSources([file], 'drop')[0].outputDirectories).toEqual(['Artist', 'Album']);
    expect(converterSources([file])[0].outputDirectories).toEqual([]);
  });

  it('omits the complete native root even when a parent has the same name', () => {
    const file = registerImportedFile(new File([], 'track.flac'), {
      path: 'C:/Music/Archive/Music/Artist/track.flac', nativeFile: { uri: 'file:///C:/Music/Archive/Music/Artist/track.flac' }
    });
    const folder = { name: 'Music', nativeFolder: { uri: 'file:///C:/Music/Archive/Music', name: 'Music' } };
    expect(converterSources([file], folder)[0].outputDirectories).toEqual(['Artist']);
  });
});
