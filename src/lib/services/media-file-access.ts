import type { NativeFileReference } from './platform-files-types';

/** Transient editing capabilities, separate from persisted FSA handles/references. */
export type MediaWritable = WritableStream<FileSystemWriteChunkType> & {
  write(data: FileSystemWriteChunkType): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
};

export interface MediaFileAccess {
  name: string;
  nativeFile?: NativeFileReference;
  getFile(): Promise<File>;
  queryPermission?(options: FileSystemPermissionDescriptor): Promise<FileSystemPermissionState>;
  requestPermission?(options: FileSystemPermissionDescriptor): Promise<FileSystemPermissionState>;
  createWritable?(options?: FileSystemCreateWritableOptions): Promise<MediaWritable>;
  move?(name: string): Promise<void>;
}

export interface MediaDirectoryAccess {
  name: string;
  queryPermission?(options: FileSystemPermissionDescriptor): Promise<FileSystemPermissionState>;
  requestPermission?(options: FileSystemPermissionDescriptor): Promise<FileSystemPermissionState>;
  getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<MediaFileAccess>;
  getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<MediaDirectoryAccess>;
  removeEntry(name: string): Promise<void>;
}

export interface NativeMediaAccess {
  file: MediaFileAccess;
  parent: MediaDirectoryAccess;
}

export function asFileSystemFileHandle(access: MediaFileAccess | null | undefined): FileSystemFileHandle | undefined {
  return access && 'kind' in access && access.kind === 'file' ? access as FileSystemFileHandle : undefined;
}
