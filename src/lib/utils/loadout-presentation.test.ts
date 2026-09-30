import { describe, expect, it } from 'vitest';
import { getLoadoutIcon, getLoadoutTargetText } from './loadout-presentation';

describe('loadout target presentation', () => {
  it('uses custom symbols or falls back to the target type', () => {
    expect(getLoadoutIcon({ icon: 'star', target: { type: 'preset' } })).toBe('star');
    expect(getLoadoutIcon({ target: { type: 'preset' } })).toBe('bookmark');
    expect(getLoadoutIcon({ target: { type: 'file', fileKey: 'track' } })).toBe('audio_file');
    expect(getLoadoutIcon({ target: { type: 'path', folderId: 'folder', folderName: 'Music' } })).toBe('folder');
    expect(getLoadoutIcon({ target: { type: 'type', recognizedType: 'xm' } })).toBe('extension');
    expect(getLoadoutIcon({ target: { type: 'tags', pattern: '.*' } })).toBe('tag');
  });

  it('returns the original matcher text for automatic loadouts', () => {
    expect(getLoadoutTargetText({ type: 'file', fileKey: 'key', fileName: 'Track.flac' })).toBe('Track.flac');
    expect(getLoadoutTargetText({ type: 'path', folderId: 'folder', folderName: 'Albums' })).toBe('Albums');
    expect(getLoadoutTargetText({ type: 'type', recognizedType: 'flac' })).toBe('FLAC');
    expect(getLoadoutTargetText({ type: 'tags', pattern: '^Artist -' })).toBe('^Artist -');
  });

  it('omits source text when a loadout has no automatic matcher', () => {
    expect(getLoadoutTargetText({ type: 'preset' })).toBeNull();
  });
});
