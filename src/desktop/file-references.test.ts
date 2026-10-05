import { describe, expect, it } from 'vitest';
import { desktopFilePath, desktopFileReference } from './file-references';
import { nativeFileIdentity } from '$lib/utils/native-media-files';

describe('desktop URI references', () => {
  it.each(['C:/Music/şarkı #1%25.flac', 'C:/', '//nas/Music/şarkı.flac', '/home/toz/Music/şarkı #1%25.flac', '/home/toz/back\\slash.flac', '/'])('round-trips %s', path => {
    expect(desktopFilePath(desktopFileReference(path))).toBe(path);
  });
  it('normalizes separators and compares Windows paths without case sensitivity', () => {
    expect(desktopFilePath(desktopFileReference('C:\\Music\\Track.flac'))).toBe('C:/Music/Track.flac');
    expect(nativeFileIdentity(desktopFileReference('C:/Music/Track.flac').uri))
      .toBe(nativeFileIdentity(desktopFileReference('c:/music/track.flac').uri));
  });
  it('rejects relative paths, foreign schemes and encoded path separators', () => {
    expect(() => desktopFileReference('Music/song.flac')).toThrow();
    for (const uri of ['content://provider/song', 'file:///C:/Music%2Fsong.flac']) {
      expect(() => desktopFilePath({ uri })).toThrow();
    }
  });
  it('preserves Linux case sensitivity through collection identity', () => {
    expect(nativeFileIdentity(desktopFileReference('/Music/Track.flac').uri))
      .not.toBe(nativeFileIdentity(desktopFileReference('/Music/track.flac').uri));
  });
});
