import { describe, expect, it } from 'vitest';
import {
  EMPTY_COLLECTION_SELECTION,
  reduceCollection,
  type CollectionState
} from './collection-reducer';

interface Entity {
  id: string;
  path: string;
  rating?: number;
}

const policy = { dedupe: true, identity: (entity: Entity) => entity.path.toLowerCase() };
const options = { shuffle: false, repeatMode: 'off' as const };

function state(entities: Entity[] = []): CollectionState<Entity> {
  return {
    entities,
    selection: EMPTY_COLLECTION_SELECTION,
    playbackOptions: options,
    catalogRevision: 0,
    revision: 0
  };
}

describe('collection command reducer', () => {
  it('hydrates deterministically, dedupes by policy, and normalizes stale selection', () => {
    const first = { id: 'a', path: 'Album/A.flac' };
    const duplicate = { id: 'a2', path: 'album/a.flac' };
    const reduced = reduceCollection(state(), {
      type: 'hydrate',
      entities: [first, duplicate],
      selection: { ids: ['missing', 'a'], anchorId: 'missing', focusId: 'missing' },
      playbackOptions: options
    }, policy);

    expect(reduced.state).toEqual({
      entities: [first],
      selection: { ids: ['a'], anchorId: 'a', focusId: 'a' },
      playbackOptions: options,
      catalogRevision: 1,
      revision: 1
    });
    expect(reduced.duplicates).toEqual([duplicate]);
  });

  it('keeps playlist duplicates when the policy disables deduplication', () => {
    const entity = { id: 'a', path: 'same.flac' };
    const duplicate = { id: 'b', path: 'same.flac' };
    const reduced = reduceCollection(state([entity]), { type: 'add', entities: [duplicate] }, {
      ...policy,
      dedupe: false
    });

    expect(reduced.state.entities).toEqual([entity, duplicate]);
    expect(reduced.duplicates).toEqual([]);
  });

  it('evaluates a live dedupe policy for every reduction', () => {
    let dedupe = true;
    const livePolicy = { ...policy, dedupe: () => dedupe };
    const existing = { id: 'a', path: 'same.flac' };
    const duplicate = { id: 'b', path: 'same.flac' };

    expect(reduceCollection(state([existing]), { type: 'add', entities: [duplicate] }, livePolicy).duplicates)
      .toEqual([duplicate]);

    dedupe = false;
    expect(reduceCollection(state([existing]), { type: 'add', entities: [duplicate] }, livePolicy).added)
      .toEqual([duplicate]);
  });

  it('selects the next entity when removing the focused entity', () => {
    const entities = [
      { id: 'a', path: 'a' },
      { id: 'b', path: 'b' },
      { id: 'c', path: 'c' }
    ];
    const current: CollectionState<Entity> = {
      ...state(entities),
      selection: { ids: ['b'], anchorId: 'b', focusId: 'b' }
    };
    const reduced = reduceCollection(current, { type: 'remove', ids: ['b'] }, policy);

    expect(reduced.state.entities.map((entity) => entity.id)).toEqual(['a', 'c']);
    expect(reduced.state.selection).toEqual({ ids: ['c'], anchorId: 'c', focusId: 'c' });
    expect(reduced.removed).toEqual([entities[1]]);
  });

  it('replaces a selected entity and preserves its selection through the replacement id', () => {
    const original = { id: 'module', path: 'song.mod' };
    const current: CollectionState<Entity> = {
      ...state([original]),
      selection: { ids: ['module'], anchorId: 'module', focusId: 'module' }
    };
    const subsong = { id: 'module:1', path: 'song.mod#1' };
    const reduced = reduceCollection(current, {
      type: 'replace-one', id: 'module', replacements: [subsong]
    }, policy);

    expect(reduced.state.entities).toEqual([subsong]);
    expect(reduced.state.selection).toEqual({
      ids: ['module:1'], anchorId: 'module:1', focusId: 'module:1'
    });
  });

  it('returns the original immutable state for semantic no-ops', () => {
    const current = state([{ id: 'a', path: 'a' }]);
    const reduced = reduceCollection(current, { type: 'remove', ids: ['missing'] }, policy);
    expect(reduced.changed).toBe(false);
    expect(reduced.state).toBe(current);
    expect(reduced.state.revision).toBe(0);
  });

  it('patches durable fields without allowing a command to replace identity', () => {
    const current = state([{ id: 'a', path: 'old', rating: 1 }]);
    const reduced = reduceCollection(current, {
      type: 'patch', id: 'a', patch: { id: 'wrong', path: 'new', rating: 4 }
    }, policy);
    expect(reduced.state.entities).toEqual([{ id: 'a', path: 'new', rating: 4 }]);
  });

  it('retains valid selection when applying a planned catalog replacement', () => {
    const first = { id: 'a', path: 'a' };
    const selected = { id: 'b', path: 'b' };
    const current: CollectionState<Entity> = {
      ...state([first, selected]),
      selection: { ids: ['b'], anchorId: 'b', focusId: 'b' }
    };
    const replacement = { ...selected, rating: 4 };
    const added = { id: 'c', path: 'c' };
    const reduced = reduceCollection(current, {
      type: 'apply-catalog', entities: [first, replacement, added]
    }, policy);

    expect(reduced.state.entities).toEqual([first, replacement, added]);
    expect(reduced.state.selection).toEqual({ ids: ['b'], anchorId: 'b', focusId: 'b' });
    expect(reduced.state.catalogRevision).toBe(1);
  });

  it('does not advance the catalog revision for selection-only changes', () => {
    const entity = { id: 'a', path: 'a' };
    const reduced = reduceCollection(state([entity]), {
      type: 'set-selection', selection: { ids: ['a'], anchorId: 'a', focusId: 'a' }
    }, policy);
    expect(reduced.state.revision).toBe(1);
    expect(reduced.state.catalogRevision).toBe(0);
  });
});
