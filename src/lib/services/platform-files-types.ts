import type { NativeMediaAccess } from './media-file-access';

/** Serializable shell references; these are never File System Access handles. */
export interface NativeFileReference { uri: string }
export interface NativeFolderReference { uri: string; name: string }
export type NativeReferenceScheme = 'content:' | 'file:';
export type NativeFolderPermission = 'granted' | 'prompt' | 'denied' | 'unavailable';

export interface NativeFilesystem {
  referenceScheme: NativeReferenceScheme;
  pickFiles(): Promise<File[]>;
  pickFolder(): Promise<NativeFolderReference>;
  readFolder(folder: NativeFolderReference, maxDepth: number): Promise<File[]>;
  queryFolderPermission(folder: NativeFolderReference, probe: boolean): Promise<NativeFolderPermission>;
  requestFolderPermission(folder: NativeFolderReference): Promise<'granted' | 'denied'>;
  materializeFile(reference: NativeFileReference): Promise<File>;
  /** Shell editing targets are transient and must never be stored as FSA handles. */
  getMediaAccess?(reference: NativeFileReference): Promise<NativeMediaAccess>;
}

export function isNativeFileReference(value: unknown, scheme?: NativeReferenceScheme): value is NativeFileReference {
  if (!value || typeof value !== 'object' || !('uri' in value) || typeof value.uri !== 'string') return false;
  try {
    const uri = new URL(value.uri);
    return (uri.protocol === 'content:' || uri.protocol === 'file:')
      && (!scheme || uri.protocol === scheme)
      && !uri.username && !uri.password && !uri.search && !uri.hash
      && (uri.protocol === 'file:' ? /^\/[a-z]:\//i.test(uri.pathname) || Boolean(uri.host && uri.pathname !== '/') : Boolean(uri.host));
  } catch { return false; }
}

export function isNativeFolderReference(value: unknown, scheme?: NativeReferenceScheme): value is NativeFolderReference {
  return isNativeFileReference(value, scheme) && 'name' in value && typeof value.name === 'string';
}

/** Local reference paths are also used by pure folder/loadout selectors. */
export function nativeFilePath(reference: NativeFileReference): string | null {
  if (!isNativeFileReference(reference, 'file:')) return null;
  try {
    const uri = new URL(reference.uri);
    if (/%2f|%5c|%00/i.test(uri.pathname)) return null;
    const path = decodeURIComponent(uri.pathname);
    return uri.host ? `//${uri.host}${path}` : path.slice(1);
  } catch { return null; }
}
