interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  id?: string;
  types?: FilePickerAcceptType[];
}

interface FileSystemHandle {
  readonly kind: 'file' | 'directory';
  readonly name: string;
  queryPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<FileSystemPermissionState>;
  requestPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<FileSystemPermissionState>;
  isSameEntry?(other: FileSystemHandle): Promise<boolean>;
}

interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: 'file';
  getFile(): Promise<File>;
  createWritable?(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: 'directory';
  values(): AsyncIterableIterator<FileSystemHandle>;
  resolve?(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

interface LaunchParams {
  readonly files?: readonly FileSystemHandle[];
  readonly targetURL?: string;
}

interface LaunchQueue {
  setConsumer(consumer: (launchParams: LaunchParams) => void): void;
}

interface Window {
  launchQueue?: LaunchQueue;
}
