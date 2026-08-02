import { describe, expect, it } from 'vitest';
import type { PlaylistItem, WorkspaceLibraryGroupRequest } from '$lib/types';
import { findRequestedLibraryGroup } from './library-group-navigation';
import type { LibraryGroup } from './library-views';

const track: PlaylistItem = {
  id: 'library-track',
  name: 'Track.flac',
  extension: 'flac',
  kind: 'stream',
  size: 1,
  lastModified: 1
};

const request: WorkspaceLibraryGroupRequest = {
  view: 'albums',
  groupKey: 'albums:album\u0000artist',
  trackId: track.id,
  token: 1
};

const albumGroup: LibraryGroup = {
  key: request.groupKey,
  label: 'Album',
  secondary: 'Artist',
  items: [track],
  duration: 0
};

describe('library group navigation readiness', () => {
  it('waits until both the requested view and its projected group are ready', () => {
    expect(findRequestedLibraryGroup(request, 'songs', [])).toBeNull();
    expect(findRequestedLibraryGroup(request, 'albums', [])).toBeNull();
    expect(findRequestedLibraryGroup(request, 'albums', [albumGroup])).toBe(albumGroup);
  });

  it('rejects a same-key group that does not contain the requested track', () => {
    expect(findRequestedLibraryGroup(request, 'albums', [{
      ...albumGroup,
      items: [{ ...track, id: 'other' }]
    }])).toBeNull();
  });
});
