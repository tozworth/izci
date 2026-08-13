import type {
  PlaylistPlaybackOptions,
  PlaylistSelection
} from '$lib/contracts/catalog';

export interface CollectionEntity {
  readonly id: string;
}

export interface CollectionState<TEntity extends CollectionEntity> {
  readonly entities: readonly TEntity[];
  readonly selection: PlaylistSelection;
  readonly playbackOptions: PlaylistPlaybackOptions;
  /** Changes only when the durable entity catalog changes. */
  readonly catalogRevision: number;
  /** Changes for every entity, selection, or playback-options mutation. */
  readonly revision: number;
}

export interface CollectionPolicy<TEntity extends CollectionEntity> {
  readonly dedupe: boolean;
  identity(entity: TEntity): string;
}

export type CollectionCommand<TEntity extends CollectionEntity> =
  | {
      readonly type: 'hydrate';
      readonly entities: readonly TEntity[];
      readonly selection: PlaylistSelection;
      readonly playbackOptions: PlaylistPlaybackOptions;
    }
  | { readonly type: 'add'; readonly entities: readonly TEntity[] }
  | { readonly type: 'replace-all'; readonly entities: readonly TEntity[] }
  | {
      /** Replaces the catalog while retaining every still-valid selection. */
      readonly type: 'apply-catalog';
      readonly entities: readonly TEntity[];
    }
  | { readonly type: 'remove'; readonly ids: readonly string[] }
  | {
      readonly type: 'replace-one';
      readonly id: string;
      readonly replacements: readonly TEntity[];
    }
  | { readonly type: 'patch'; readonly id: string; readonly patch: Partial<TEntity> }
  | { readonly type: 'set-selection'; readonly selection: PlaylistSelection }
  | { readonly type: 'set-playback-options'; readonly options: PlaylistPlaybackOptions };

export interface CollectionReduction<TEntity extends CollectionEntity> {
  readonly state: CollectionState<TEntity>;
  readonly changed: boolean;
  readonly added: readonly TEntity[];
  readonly removed: readonly TEntity[];
  readonly duplicates: readonly TEntity[];
}

export const EMPTY_COLLECTION_SELECTION: PlaylistSelection = {
  ids: [],
  anchorId: null,
  focusId: null
};

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSelection(left: PlaylistSelection, right: PlaylistSelection): boolean {
  return sameArray(left.ids, right.ids)
    && left.anchorId === right.anchorId
    && left.focusId === right.focusId;
}

function normalizeSelection<TEntity extends CollectionEntity>(
  entities: readonly TEntity[],
  selection: PlaylistSelection
): PlaylistSelection {
  const entityIds = new Set(entities.map((entity) => entity.id));
  const selected = new Set(selection.ids.filter((id) => entityIds.has(id)));
  const ids = entities.filter((entity) => selected.has(entity.id)).map((entity) => entity.id);
  if (ids.length === 0) return EMPTY_COLLECTION_SELECTION;
  const focusId = selection.focusId && selected.has(selection.focusId)
    ? selection.focusId
    : ids.at(-1) ?? null;
  const anchorId = selection.anchorId && entityIds.has(selection.anchorId)
    ? selection.anchorId
    : focusId;
  return { ids, anchorId, focusId };
}

function removeSelection<TEntity extends CollectionEntity>(
  previous: readonly TEntity[],
  next: readonly TEntity[],
  selection: PlaylistSelection,
  removedIds: ReadonlySet<string>
): PlaylistSelection {
  const retained = selection.ids.filter((id) => !removedIds.has(id));
  if (retained.length > 0 || selection.ids.every((id) => !removedIds.has(id))) {
    return normalizeSelection(next, {
      ids: retained,
      anchorId: removedIds.has(selection.anchorId ?? '') ? null : selection.anchorId,
      focusId: removedIds.has(selection.focusId ?? '') ? null : selection.focusId
    });
  }
  const removedIndexes = previous.flatMap((entity, index) => removedIds.has(entity.id) ? [index] : []);
  const fallbackIndex = Math.min(Math.max(0, Math.min(...removedIndexes)), next.length - 1);
  const fallback = next[fallbackIndex];
  return fallback
    ? { ids: [fallback.id], anchorId: fallback.id, focusId: fallback.id }
    : EMPTY_COLLECTION_SELECTION;
}

function unique<TEntity extends CollectionEntity>(
  incoming: readonly TEntity[],
  policy: CollectionPolicy<TEntity>,
  existing: readonly TEntity[] = []
): { entities: TEntity[]; duplicates: TEntity[] } {
  if (!policy.dedupe) return { entities: [...incoming], duplicates: [] };
  const identities = new Set(existing.map(policy.identity));
  const entities: TEntity[] = [];
  const duplicates: TEntity[] = [];
  for (const entity of incoming) {
    const identity = policy.identity(entity);
    if (identities.has(identity)) duplicates.push(entity);
    else {
      identities.add(identity);
      entities.push(entity);
    }
  }
  return { entities, duplicates };
}

function result<TEntity extends CollectionEntity>(
  previous: CollectionState<TEntity>,
  next: Omit<CollectionState<TEntity>, 'revision' | 'catalogRevision'>,
  details: Pick<CollectionReduction<TEntity>, 'added' | 'removed' | 'duplicates'>,
  changed: boolean,
  catalogChanged = changed
): CollectionReduction<TEntity> {
  return {
    state: changed ? {
      ...next,
      catalogRevision: previous.catalogRevision + (catalogChanged ? 1 : 0),
      revision: previous.revision + 1
    } : previous,
    changed,
    ...details
  };
}

const noEntities = <TEntity extends CollectionEntity>(): readonly TEntity[] => [];

export function reduceCollection<TEntity extends CollectionEntity>(
  state: CollectionState<TEntity>,
  command: CollectionCommand<TEntity>,
  policy: CollectionPolicy<TEntity>
): CollectionReduction<TEntity> {
  const empty = { added: noEntities<TEntity>(), removed: noEntities<TEntity>(), duplicates: noEntities<TEntity>() };
  switch (command.type) {
    case 'hydrate': {
      const projected = unique(command.entities, policy);
      const selection = normalizeSelection(projected.entities, command.selection);
      return result(state, {
        entities: projected.entities,
        selection,
        playbackOptions: command.playbackOptions
      }, { ...empty, duplicates: projected.duplicates }, true);
    }
    case 'add': {
      const projected = unique(command.entities, policy, state.entities);
      if (projected.entities.length === 0) {
        return { state, changed: false, ...empty, duplicates: projected.duplicates };
      }
      const entities = [...state.entities, ...projected.entities];
      return result(state, {
        entities,
        selection: normalizeSelection(entities, state.selection),
        playbackOptions: state.playbackOptions
      }, { ...empty, added: projected.entities, duplicates: projected.duplicates }, true);
    }
    case 'replace-all': {
      const projected = unique(command.entities, policy);
      return result(state, {
        entities: projected.entities,
        selection: EMPTY_COLLECTION_SELECTION,
        playbackOptions: state.playbackOptions
      }, { added: projected.entities, removed: state.entities, duplicates: projected.duplicates }, true);
    }
    case 'apply-catalog': {
      const projected = unique(command.entities, policy);
      const entities = projected.entities;
      const previousById = new Map(state.entities.map((entity) => [entity.id, entity]));
      const nextById = new Map(entities.map((entity) => [entity.id, entity]));
      const added = entities.filter((entity) => previousById.get(entity.id) !== entity);
      const removed = state.entities.filter((entity) => nextById.get(entity.id) !== entity);
      const changed = !sameArray(entities, state.entities);
      return result(state, {
        entities,
        selection: normalizeSelection(entities, state.selection),
        playbackOptions: state.playbackOptions
      }, { added, removed, duplicates: projected.duplicates }, changed);
    }
    case 'remove': {
      const ids = new Set(command.ids);
      if (ids.size === 0) return { state, changed: false, ...empty };
      const removed = state.entities.filter((entity) => ids.has(entity.id));
      if (removed.length === 0) return { state, changed: false, ...empty };
      const entities = state.entities.filter((entity) => !ids.has(entity.id));
      return result(state, {
        entities,
        selection: removeSelection(state.entities, entities, state.selection, ids),
        playbackOptions: state.playbackOptions
      }, { ...empty, removed }, true);
    }
    case 'replace-one': {
      const index = state.entities.findIndex((entity) => entity.id === command.id);
      if (index < 0 || command.replacements.length === 0) return { state, changed: false, ...empty };
      const outside = state.entities.filter((_, entityIndex) => entityIndex !== index);
      const projected = unique(command.replacements, policy, outside);
      if (projected.entities.length === 0) {
        return { state, changed: false, ...empty, duplicates: projected.duplicates };
      }
      const entities = [
        ...state.entities.slice(0, index),
        ...projected.entities,
        ...state.entities.slice(index + 1)
      ];
      const replacementIds = new Set(projected.entities.map((entity) => entity.id));
      const fallbackId = projected.entities[0]!.id;
      const selection = normalizeSelection(entities, {
        ids: state.selection.ids.flatMap((id) => id === command.id
          ? [replacementIds.has(id) ? id : fallbackId]
          : [id]),
        anchorId: state.selection.anchorId === command.id
          ? replacementIds.has(command.id) ? command.id : fallbackId
          : state.selection.anchorId,
        focusId: state.selection.focusId === command.id
          ? replacementIds.has(command.id) ? command.id : fallbackId
          : state.selection.focusId
      });
      return result(state, {
        entities,
        selection,
        playbackOptions: state.playbackOptions
      }, {
        added: projected.entities,
        removed: [state.entities[index]!],
        duplicates: projected.duplicates
      }, true);
    }
    case 'patch': {
      const index = state.entities.findIndex((entity) => entity.id === command.id);
      if (index < 0) return { state, changed: false, ...empty };
      const current = state.entities[index]!;
      const patched = { ...current, ...command.patch, id: current.id };
      const entities = [...state.entities];
      entities[index] = patched;
      return result(state, {
        entities,
        selection: state.selection,
        playbackOptions: state.playbackOptions
      }, { ...empty, added: [patched], removed: [current] }, true);
    }
    case 'set-selection': {
      const selection = normalizeSelection(state.entities, command.selection);
      const changed = !sameSelection(selection, state.selection);
      return result(state, {
        entities: state.entities,
        selection,
        playbackOptions: state.playbackOptions
      }, empty, changed, false);
    }
    case 'set-playback-options': {
      const changed = command.options.shuffle !== state.playbackOptions.shuffle
        || command.options.repeatMode !== state.playbackOptions.repeatMode;
      return result(state, {
        entities: state.entities,
        selection: state.selection,
        playbackOptions: changed ? { ...command.options } : state.playbackOptions
      }, empty, changed, false);
    }
  }
}
