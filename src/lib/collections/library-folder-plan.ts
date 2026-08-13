import type { MediaEntity } from '$lib/contracts/catalog';
import type { MediaSourceLocator } from '$lib/media/media-source';

export interface ScannedLibraryFolderEntry {
  readonly entity: MediaEntity;
  readonly fileHandle: FileSystemFileHandle;
}

export type CurrentMediaSourceHandle = Required<
  Pick<MediaSourceLocator, 'entityId' | 'fileHandle'>
>;

export interface LibraryFolderDuplicateEntry {
  readonly entityId: string;
  readonly path: string;
}

export interface LibraryFolderDuplicateDiagnostic {
  /** Normalized, case-insensitive path used to identify this duplicate group. */
  readonly identity: string;
  readonly kept: LibraryFolderDuplicateEntry;
  readonly discarded: readonly LibraryFolderDuplicateEntry[];
}

export interface LibraryFolderReconciliationPlan {
  readonly nextCatalog: readonly MediaEntity[];
  readonly addedItems: readonly MediaEntity[];
  readonly updatedItems: readonly MediaEntity[];
  readonly removedItems: readonly MediaEntity[];
  /** Runtime/persistent source registrations to apply only after the plan is accepted. */
  readonly sourceRegistrations: readonly MediaSourceLocator[];
  /** Source entity IDs to release only after the plan is accepted. */
  readonly sourceDeletions: readonly string[];
  readonly duplicates: readonly LibraryFolderDuplicateDiagnostic[];
}

export interface PlanLibraryFolderReconciliationOptions {
  readonly catalog: readonly MediaEntity[];
  readonly folderId: string;
  readonly activeFolderIds: readonly string[];
  readonly scanned: readonly ScannedLibraryFolderEntry[];
  /** File handles currently held by the source owner, passed in explicitly for move detection. */
  readonly currentSourceHandles: readonly CurrentMediaSourceHandle[];
  /** Required only when a newly scanned entity collides with an existing entity ID. */
  readonly createId?: () => string;
}

interface CanonicalScanEntry extends ScannedLibraryFolderEntry {
  readonly entity: MediaEntity;
  readonly pathIdentity: string;
}

interface ExistingCandidate {
  readonly entity: MediaEntity;
  readonly ownershipRank: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeLibraryFolderPath(path: string, fallback: string): string {
  const normalized = path
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
  return normalized || fallback;
}

function pathIdentity(path: string): string {
  return path.toLowerCase();
}

function compareEntitiesByPath(left: MediaEntity, right: MediaEntity): number {
  return compareText(pathIdentity(left.path), pathIdentity(right.path))
    || compareText(left.path, right.path)
    || compareText(left.name, right.name)
    || compareText(left.format, right.format)
    || compareText(left.kind, right.kind)
    || left.size - right.size
    || left.lastModified - right.lastModified
    || compareText(left.id, right.id);
}

function compareScans(left: CanonicalScanEntry, right: CanonicalScanEntry): number {
  return compareEntitiesByPath(left.entity, right.entity);
}

function compareExisting(left: ExistingCandidate, right: ExistingCandidate): number {
  return left.ownershipRank - right.ownershipRank
    || compareEntitiesByPath(left.entity, right.entity);
}

function canonicalizeScan(
  entry: ScannedLibraryFolderEntry,
  folderId: string
): CanonicalScanEntry {
  const path = normalizeLibraryFolderPath(entry.entity.path, entry.entity.name);
  const entity: MediaEntity = {
    ...entry.entity,
    path,
    sourceFolderId: folderId
  };
  return { ...entry, entity, pathIdentity: pathIdentity(path) };
}

function collapseDuplicateScans(
  scanned: readonly ScannedLibraryFolderEntry[],
  folderId: string
): {
  readonly kept: CanonicalScanEntry[];
  readonly discardedIds: string[];
  readonly diagnostics: LibraryFolderDuplicateDiagnostic[];
} {
  const ordered = scanned.map((entry) => canonicalizeScan(entry, folderId)).sort(compareScans);
  const kept: CanonicalScanEntry[] = [];
  const discardedIds: string[] = [];
  const diagnostics: LibraryFolderDuplicateDiagnostic[] = [];

  for (let index = 0; index < ordered.length;) {
    const first = ordered[index];
    const group = [first];
    index += 1;
    while (index < ordered.length && ordered[index].pathIdentity === first.pathIdentity) {
      group.push(ordered[index]);
      index += 1;
    }

    kept.push(first);
    if (group.length === 1) continue;

    const discarded = group.slice(1);
    discardedIds.push(...discarded.map((entry) => entry.entity.id));
    diagnostics.push({
      identity: first.pathIdentity,
      kept: { entityId: first.entity.id, path: first.entity.path },
      discarded: discarded.map((entry) => ({
        entityId: entry.entity.id,
        path: entry.entity.path
      }))
    });
  }

  return { kept, discardedIds, diagnostics };
}

function contentChanged(existing: MediaEntity, candidate: MediaEntity): boolean {
  return existing.size !== candidate.size
    || existing.lastModified !== candidate.lastModified
    || existing.kind !== candidate.kind
    || existing.format !== candidate.format;
}

function replaceExistingEntity(existing: MediaEntity, candidate: MediaEntity): MediaEntity {
  const changed = contentChanged(existing, candidate);
  const metadata = changed
    ? existing.metadata?.playCount === undefined
      ? undefined
      : { playCount: existing.metadata.playCount }
    : existing.metadata;
  const {
    id: _candidateId,
    metadata: _candidateMetadata,
    rating: _candidateRating,
    ...candidateFacts
  } = candidate;

  return {
    ...candidateFacts,
    id: existing.id,
    ...(metadata === undefined ? {} : { metadata }),
    ...(existing.rating === undefined ? {} : { rating: existing.rating })
  };
}

function entityChanged(existing: MediaEntity, replacement: MediaEntity): boolean {
  return existing.path !== replacement.path
    || existing.name !== replacement.name
    || existing.format !== replacement.format
    || existing.kind !== replacement.kind
    || existing.size !== replacement.size
    || existing.lastModified !== replacement.lastModified
    || existing.sourceFolderId !== replacement.sourceFolderId
    || existing.subsong !== replacement.subsong
    || existing.metadata !== replacement.metadata
    || existing.rating !== replacement.rating;
}

async function handlesReferToSameEntry(
  existing: FileSystemFileHandle,
  scanned: FileSystemFileHandle
): Promise<boolean> {
  if (typeof existing.isSameEntry !== 'function') return false;
  try {
    return await existing.isSameEntry(scanned);
  } catch {
    return false;
  }
}

function allocateEntityId(
  preferredId: string,
  usedIds: Set<string>,
  createId: (() => string) | undefined
): string {
  if (preferredId && !usedIds.has(preferredId)) {
    usedIds.add(preferredId);
    return preferredId;
  }
  if (!createId) {
    throw new Error(`A createId function is required to replace the colliding media entity ID ${preferredId || '(empty)'}.`);
  }

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const id = createId();
    if (id && !usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
  throw new Error('createId did not produce a unique media entity ID.');
}

function withEntityId(entity: MediaEntity, id: string): MediaEntity {
  return entity.id === id ? entity : { ...entity, id };
}

/**
 * Builds a side-effect-free managed-folder commit plan. Callers remain responsible for
 * validating their folder/catalog generation before applying the catalog and source stages.
 */
export async function planLibraryFolderReconciliation(
  options: PlanLibraryFolderReconciliationOptions
): Promise<LibraryFolderReconciliationPlan> {
  const activeFolderIds = new Set(options.activeFolderIds);
  const collapsed = collapseDuplicateScans(options.scanned, options.folderId);
  const eligible = options.catalog
    .filter((entity) => (
      entity.sourceFolderId === options.folderId
      || !entity.sourceFolderId
      || !activeFolderIds.has(entity.sourceFolderId)
    ))
    .map((entity): ExistingCandidate => ({
      entity,
      ownershipRank: entity.sourceFolderId === options.folderId ? 0 : 1
    }))
    .sort(compareExisting);
  const exactByPath = new Map<string, ExistingCandidate[]>();
  for (const candidate of eligible) {
    const identity = pathIdentity(normalizeLibraryFolderPath(candidate.entity.path, candidate.entity.name));
    const matches = exactByPath.get(identity) ?? [];
    matches.push(candidate);
    exactByPath.set(identity, matches);
  }

  const currentHandles = new Map<string, FileSystemFileHandle>();
  for (const source of [...options.currentSourceHandles].sort((left, right) => compareText(left.entityId, right.entityId))) {
    if (!currentHandles.has(source.entityId)) currentHandles.set(source.entityId, source.fileHandle);
  }

  const matchedIds = new Set<string>();
  const replacements = new Map<string, MediaEntity>();
  const addedItems: MediaEntity[] = [];
  const updatedItems: MediaEntity[] = [];
  const registrations: MediaSourceLocator[] = [];
  const provisionalDeletions = new Set(collapsed.discardedIds);
  const usedIds = new Set(options.catalog.map((entity) => entity.id));

  for (const scan of collapsed.kept) {
    const exact = exactByPath.get(scan.pathIdentity)?.find(({ entity }) => !matchedIds.has(entity.id));
    let existing = exact?.entity;

    if (!existing) {
      for (const possible of eligible) {
        if (matchedIds.has(possible.entity.id)) continue;
        const existingHandle = currentHandles.get(possible.entity.id);
        if (!existingHandle) continue;
        if (await handlesReferToSameEntry(existingHandle, scan.fileHandle)) {
          existing = possible.entity;
          break;
        }
      }
    }

    if (existing) {
      matchedIds.add(existing.id);
      const candidate = replaceExistingEntity(existing, scan.entity);
      const changed = entityChanged(existing, candidate);
      const replacement = changed ? candidate : existing;
      replacements.set(existing.id, replacement);
      if (changed) updatedItems.push(replacement);
      registrations.push({
        entityId: existing.id,
        fileHandle: scan.fileHandle,
        permission: 'granted'
      });
      if (scan.entity.id !== existing.id) provisionalDeletions.add(scan.entity.id);
      continue;
    }

    const id = allocateEntityId(scan.entity.id, usedIds, options.createId);
    const added = withEntityId(scan.entity, id);
    addedItems.push(added);
    registrations.push({
      entityId: id,
      fileHandle: scan.fileHandle,
      permission: 'granted'
    });
    if (id !== scan.entity.id) provisionalDeletions.add(scan.entity.id);
  }

  const removedItems = options.catalog.filter((entity) => (
    entity.sourceFolderId === options.folderId && !matchedIds.has(entity.id)
  ));
  const removedIds = new Set(removedItems.map((entity) => entity.id));
  const nextCatalog = options.catalog
    .filter((entity) => !removedIds.has(entity.id))
    .map((entity) => replacements.get(entity.id) ?? entity)
    .concat(addedItems);
  const finalIds = new Set(nextCatalog.map((entity) => entity.id));
  const nextById = new Map(nextCatalog.map((entity) => [entity.id, entity]));
  const sourceDeletions = [...new Set([
    ...removedIds,
    ...provisionalDeletions
  ])]
    .filter((entityId) => !finalIds.has(entityId))
    .sort(compareText);

  return {
    nextCatalog,
    addedItems: [...addedItems].sort(compareEntitiesByPath),
    updatedItems: [...updatedItems].sort(compareEntitiesByPath),
    removedItems: [...removedItems].sort(compareEntitiesByPath),
    sourceRegistrations: registrations.sort((left, right) => {
      const leftEntity = nextById.get(left.entityId);
      const rightEntity = nextById.get(right.entityId);
      if (leftEntity && rightEntity) return compareEntitiesByPath(leftEntity, rightEntity);
      return compareText(left.entityId, right.entityId);
    }),
    sourceDeletions,
    duplicates: collapsed.diagnostics
  };
}
