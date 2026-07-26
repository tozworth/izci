import { describe, expect, it } from 'vitest';
import { getLoadoutTargetText } from './loadout-presentation';

describe('loadout target presentation', () => {
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
