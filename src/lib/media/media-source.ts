import type { MediaEntity } from '$lib/contracts/catalog';
import type { ObjectUrlPort } from '$lib/runtime/ports';
import { inferMediaExtension, inferTrackKind } from './format-policy';

export type MediaSourcePermission = 'granted' | 'prompt' | 'denied' | 'unavailable';

export interface MediaSourceLocator {
  readonly entityId: string;
  readonly file?: File;
  readonly fileHandle?: FileSystemFileHandle;
  readonly permission: MediaSourcePermission;
}

export interface MediaMaterializationLease {
  readonly entity: MediaEntity;
  readonly file: File;
  readonly objectUrl?: string;
  release(): void;
}

export interface MaterializeMediaOptions {
  readonly prompt?: boolean;
  readonly objectUrls: ObjectUrlPort;
}

type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';

function normalizePath(path: string, fallback: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  return normalized || fallback;
}

async function queryPermission(handle: FileSystemFileHandle): Promise<MediaSourcePermission> {
  if (typeof handle.queryPermission !== 'function') return 'granted';
  try {
    return await handle.queryPermission({ mode: 'read' });
  } catch {
    return 'unavailable';
  }
}

async function requestPermission(handle: FileSystemFileHandle): Promise<FileSystemPermissionState> {
  if (typeof handle.requestPermission !== 'function') return 'granted';
  try {
    return await handle.requestPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }
}

function entityForFile(entity: MediaEntity, file: File): MediaEntity | null {
  const format = inferMediaExtension(file.name);
  const inferredKind = inferTrackKind(format);
  const kind = inferredKind ?? (entity.kind === 'module' ? 'module' : null);
  if (!kind) return null;
  return {
    ...entity,
    path: normalizePath(entity.path, file.name),
    name: file.name,
    format,
    kind,
    size: file.size,
    lastModified: file.lastModified
  };
}

export async function materializeMediaEntity(
  entity: MediaEntity,
  locator: MediaSourceLocator | null | undefined,
  options: MaterializeMediaOptions
): Promise<MediaMaterializationLease | null> {
  if (!locator || locator.entityId !== entity.id) return null;

  let file = locator.file;
  if (!file && locator.fileHandle) {
    const permission = await queryPermission(locator.fileHandle);
    if (permission !== 'granted') {
      if (!options.prompt || await requestPermission(locator.fileHandle) !== 'granted') return null;
    }
    file = await locator.fileHandle.getFile();
  }
  if (!file) return null;

  const refreshedEntity = entityForFile(entity, file);
  if (!refreshedEntity) return null;

  let objectUrl: string | undefined;
  if (refreshedEntity.kind === 'stream' || refreshedEntity.kind === 'video') {
    objectUrl = options.objectUrls.create(file);
  }
  let released = false;
  return {
    entity: refreshedEntity,
    file,
    ...(objectUrl === undefined ? {} : { objectUrl }),
    release() {
      if (released) return;
      released = true;
      if (objectUrl !== undefined) options.objectUrls.revoke(objectUrl);
    }
  };
}

export class MediaSourceRegistry {
  readonly #locators = new Map<string, MediaSourceLocator>();

  get(entityId: string): MediaSourceLocator | null {
    return this.#locators.get(entityId) ?? null;
  }

  register(locator: MediaSourceLocator): void {
    this.#locators.set(locator.entityId, locator);
  }

  registerFile(entityId: string, file: File): void {
    const current = this.#locators.get(entityId);
    this.register({
      entityId,
      file,
      ...(current?.fileHandle === undefined ? {} : { fileHandle: current.fileHandle }),
      permission: current?.permission ?? 'granted'
    });
  }

  registerHandle(entityId: string, fileHandle: FileSystemFileHandle, permission: MediaSourcePermission): void {
    this.register({ entityId, fileHandle, permission });
  }

  clone(sourceEntityId: string, targetEntityId: string): void {
    const current = this.#locators.get(sourceEntityId);
    if (!current) return;
    this.register({ ...current, entityId: targetEntityId });
  }

  remove(entityId: string): void {
    this.#locators.delete(entityId);
  }

  clear(): void {
    this.#locators.clear();
  }
}

export const mediaSources = new MediaSourceRegistry();

