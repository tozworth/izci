export interface GroupableTrack {
  id: string;
  path: string;
  album?: string;
  albumArtist?: string;
  discNumber?: string;
  trackNumber?: string;
}

export interface ProposedAlbumGroup {
  id: string;
  title: string;
  albumArtist: string;
  itemIds: string[];
}

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : '';
}

function position(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.MAX_SAFE_INTEGER;
}

export function autoGroupTracks(
  tracks: GroupableTrack[],
  fallback: 'folder' | 'none' = 'folder'
): ProposedAlbumGroup[] {
  const groups = new Map<string, ProposedAlbumGroup>();
  for (const track of tracks) {
    const album = track.album?.trim() ?? '';
    const artist = track.albumArtist?.trim() ?? '';
    const folder = fallback === 'folder' ? parentPath(track.path) : '';
    const title = album || folder.split('/').at(-1) || '';
    if (!title) continue;
    const key = album
      ? `tag:${artist.toLocaleLowerCase()}\u0000${album.toLocaleLowerCase()}`
      : `folder:${folder.toLocaleLowerCase()}`;
    const group = groups.get(key) ?? {
      id: `album:${key}`,
      title,
      albumArtist: artist,
      itemIds: []
    };
    group.itemIds.push(track.id);
    groups.set(key, group);
  }
  const byId = new Map(tracks.map((track) => [track.id, track]));
  for (const group of groups.values()) {
    group.itemIds.sort((leftId, rightId) => {
      const left = byId.get(leftId)!;
      const right = byId.get(rightId)!;
      return position(left.discNumber) - position(right.discNumber)
        || position(left.trackNumber) - position(right.trackNumber)
        || left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' });
    });
  }
  return [...groups.values()].sort((left, right) => left.title.localeCompare(right.title));
}

export function renumberAlbumTracks(
  itemIds: string[],
  start = 1,
  padTo = 0
): Map<string, string> {
  return new Map(itemIds.map((id, index) => {
    const value = String(Math.max(1, Math.trunc(start)) + index);
    return [id, padTo > 0 ? value.padStart(padTo, '0') : value];
  }));
}
