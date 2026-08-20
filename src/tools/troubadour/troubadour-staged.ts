import type {
  StagedWorkbenchState,
  TroubadourWorkbenchItem
} from './troubadour-controller';

export function cloneStaged(state: StagedWorkbenchState): StagedWorkbenchState {
  return {
    items: state.items.map((item) => ({
      ...item,
      patch: { ...item.patch },
      artworkEdits: [...item.artworkEdits]
    })),
    albums: state.albums.map((album) => ({ ...album, itemIds: [...album.itemIds] }))
  };
}

export function itemDirty(item: TroubadourWorkbenchItem): boolean {
  return Object.keys(item.patch).length > 0 || item.artworkEdits.length > 0;
}
