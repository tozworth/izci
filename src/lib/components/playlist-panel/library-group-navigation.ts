import type { LibraryViewId, WorkspaceLibraryGroupRequest } from '$lib/contracts/workspace';
import type { LibraryGroup } from './library-views';

export function findRequestedLibraryGroup(
  request: WorkspaceLibraryGroupRequest | null,
  activeView: LibraryViewId,
  groups: LibraryGroup[]
): LibraryGroup | null {
  if (!request || activeView !== request.view) return null;

  return groups.find((group) =>
    group.key === request.groupKey
    && group.items.some((item) => item.id === request.trackId)
  ) ?? null;
}
