import { describe, expect, it } from 'vitest';
import { miniPlayerTrackView, parseMiniPlayerCommand } from './mini-player-protocol';
import type { TrackItem } from '$lib/types';

describe('desktop mini player commands', () => {
  it('accepts bounded transport commands and rejects malformed input', () => {
    expect(parseMiniPlayerCommand({ action: 'togglePlayback' })).toEqual({ action: 'togglePlayback' });
    expect(parseMiniPlayerCommand({ action: 'seek', value: 12 })).toEqual({ action: 'seek', value: 12 });
    expect(parseMiniPlayerCommand({ action: 'setVolume', value: 0.5 })).toEqual({ action: 'setVolume', value: 0.5 });
    for (const value of [null, {}, { action: 'load' }, { action: 'seek', value: NaN }, { action: 'seek', value: -1 }, { action: 'setVolume', value: 2 }, { action: 'seek', value: '10' }]) {
      expect(parseMiniPlayerCommand(value)).toBeNull();
    }
  });

  it('transfers only track presentation data, without handles, Files, or source URLs', () => {
    const track: TrackItem = {
      id: 'track', name: 'song.mod', extension: 'mod', kind: 'module', size: 32, lastModified: 0,
      fileHandle: { getFile: () => { throw new Error('Must not read the file'); } } as unknown as FileSystemFileHandle,
      path: 'private/song.mod', objectUrl: 'blob:source', metadata: { title: 'Title', artist: 'Artist', message: 'Large module data' }
    };
    const view = miniPlayerTrackView(track);
    expect(view?.metadata).toEqual({ title: 'Title', artist: 'Artist' });
    expect(view).not.toHaveProperty('fileHandle');
    expect(view).not.toHaveProperty('file');
    expect(view).not.toHaveProperty('objectUrl');
    expect(view).not.toHaveProperty('path');
    expect(miniPlayerTrackView(null)).toBeNull();
  });
});
