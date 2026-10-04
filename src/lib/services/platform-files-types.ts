/** Serializable SAF references; these are never File System Access handles. */
export interface NativeFileReference { uri: string }
export interface NativeFolderReference { uri: string; name: string }

export interface NativeFilesystem {
  pickFiles(): Promise<File[]>;
  pickFolder(): Promise<NativeFolderReference>;
  readFolder(folder: NativeFolderReference, maxDepth: number): Promise<File[]>;
  queryFolderPermission(folder: NativeFolderReference, probe: boolean): Promise<'granted' | 'prompt' | 'unavailable'>;
  requestFolderPermission(folder: NativeFolderReference): Promise<'granted' | 'denied'>;
  materializeFile(reference: NativeFileReference): Promise<File>;
}

export function isNativeFileReference(value: unknown): value is NativeFileReference {
  return Boolean(value && typeof value === 'object' && 'uri' in value
    && typeof value.uri === 'string' && value.uri.startsWith('content://'));
}

export function isNativeFolderReference(value: unknown): value is NativeFolderReference {
  return isNativeFileReference(value) && 'name' in value && typeof value.name === 'string';
}
