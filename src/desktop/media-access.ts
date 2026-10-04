import { invoke } from '@tauri-apps/api/core';
import type { MediaDirectoryAccess, MediaFileAccess, MediaWritable, NativeMediaAccess } from '$lib/services/media-file-access';
import type { NativeFileReference } from '$lib/services/platform-files-types';
import { desktopFilePath, desktopFileReference } from './file-references';
import { readDesktopFiles } from './files';
import { MetadataWriteError } from '$lib/services/media-metadata/types';

async function command<T>(name: string, args: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(name, args); }
  catch (error) {
    const message = String(error);
    if (message.startsWith('NotFoundError:')) throw new DOMException(message, 'NotFoundError');
    if (message.startsWith('ExternalChangeError:')) throw new MetadataWriteError('external-change', message);
    throw new Error(message);
  }
}

function childPath(parent: string, name: string): string {
  if (!name || name === '.' || name === '..' || /[\\/:\0]/.test(name)) throw new Error('Invalid filesystem entry name.');
  return `${parent.replace(/\/$/, '')}/${name}`;
}

function parentPath(path: string): string {
  const parent = path.slice(0, path.lastIndexOf('/'));
  return /^[a-z]:$/i.test(parent) ? `${parent}/` : parent;
}

class NativeWritable extends WritableStream<FileSystemWriteChunkType> implements MediaWritable {
  private ended = false;
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly token: string) {
    super({
      write: (data) => this.write(data),
      close: () => this.close(),
      abort: () => this.abort()
    });
  }
  write(data: FileSystemWriteChunkType): Promise<void> {
    const operation = this.pending.then(async () => {
      if (this.ended) throw new Error('The native write is already closed.');
      if (data && typeof data === 'object' && 'type' in data && !(data instanceof Blob) && !ArrayBuffer.isView(data)) {
        if (data.type === 'seek' || data.type === 'truncate') {
          await command('update_desktop_media_write', { token: this.token, operation: data.type, position: data.type === 'seek' ? data.position : data.size, bytes: [] });
          return;
        }
        if (data.type !== 'write') throw new Error('Unsupported native write operation.');
        if (data.position !== undefined) await command('update_desktop_media_write', { token: this.token, operation: 'seek', position: data.position, bytes: [] });
        if (data.data === null || data.data === undefined) throw new Error('The native write has no data.');
        data = data.data;
      }
      const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
      for (let offset = 0; offset < blob.size; offset += 256 * 1024) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 256 * 1024).arrayBuffer());
        await command('update_desktop_media_write', { token: this.token, operation: 'write', bytes: Array.from(bytes), position: 0 });
      }
    });
    this.pending = operation;
    return operation;
  }
  async close(): Promise<void> {
    await this.pending;
    if (this.ended) return;
    await command('finish_desktop_media_write', { token: this.token, commit: true });
    this.ended = true;
  }
  async abort(): Promise<void> {
    await this.pending.catch(() => undefined);
    if (this.ended) return;
    this.ended = true;
    await command('finish_desktop_media_write', { token: this.token, commit: false });
  }
}

class NativeFileAccess implements MediaFileAccess {
  readonly kind = 'native-file';
  constructor(private path: string) {}
  get name(): string { return this.path.split('/').at(-1)!; }
  get nativeFile(): NativeFileReference { return desktopFileReference(this.path); }
  async getFile(): Promise<File> { return (await readDesktopFiles([this.path]))[0]; }
  queryPermission(): Promise<FileSystemPermissionState> {
    return command('query_desktop_media_write_permission', { path: this.path, directory: false });
  }
  requestPermission(): Promise<FileSystemPermissionState> { return this.queryPermission(); }
  async createWritable(options?: FileSystemCreateWritableOptions): Promise<MediaWritable> {
    return new NativeWritable(await command<string>('begin_desktop_media_write', { path: this.path, keepExistingData: options?.keepExistingData === true }));
  }
  async move(name: string): Promise<void> {
    const parent = parentPath(this.path);
    const destination = childPath(parent, name);
    this.path = (await command<string>('move_desktop_media_file', { path: this.path, destination })).replaceAll('\\', '/');
  }
}

class NativeDirectoryAccess implements MediaDirectoryAccess {
  readonly kind = 'native-directory';
  constructor(private readonly path: string) {}
  get name(): string { return this.path.split('/').at(-1)!; }
  queryPermission(): Promise<FileSystemPermissionState> {
    return command('query_desktop_media_write_permission', { path: this.path, directory: true });
  }
  requestPermission(): Promise<FileSystemPermissionState> { return this.queryPermission(); }
  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<MediaFileAccess> {
    const path = await command<string>('access_desktop_media_entry', { path: childPath(this.path, name), directory: false, create: options?.create === true });
    return new NativeFileAccess(path.replaceAll('\\', '/'));
  }
  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<MediaDirectoryAccess> {
    const path = await command<string>('access_desktop_media_entry', { path: childPath(this.path, name), directory: true, create: options?.create === true });
    return new NativeDirectoryAccess(path.replaceAll('\\', '/'));
  }
  async removeEntry(name: string): Promise<void> {
    await command('remove_desktop_media_entry', { path: childPath(this.path, name) });
  }
}

export async function getDesktopMediaAccess(reference: NativeFileReference): Promise<NativeMediaAccess> {
  const path = desktopFilePath(reference);
  return { file: new NativeFileAccess(path), parent: new NativeDirectoryAccess(parentPath(path)) };
}

export function getDesktopDirectoryAccess(reference: NativeFileReference): MediaDirectoryAccess {
  return new NativeDirectoryAccess(desktopFilePath(reference));
}
