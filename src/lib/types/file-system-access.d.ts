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
  queryPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<FileSystemPermissionState>;
  requestPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<FileSystemPermissionState>;
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
