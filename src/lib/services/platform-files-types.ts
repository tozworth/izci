import type { NativeMediaAccess, MediaFileAccess, MediaDirectoryAccess } from './media-file-access';

/** Serializable shell references; these are never File System Access handles. */
export interface NativeFileReference { uri: string }
export interface NativeFolderReference { uri: string; name: string }
export type NativeReferenceScheme = 'content:' | 'file:';
export type NativeFolderPermission = 'granted' | 'prompt' | 'denied' | 'unavailable';

/** Storage representations stay distinct; a platform never invents FSA handles. */
export interface FileReference {
  fileHandle?: FileSystemFileHandle;
  nativeFile?: NativeFileReference;
}
export interface FolderReference {
  handle?: FileSystemDirectoryHandle;
  nativeFolder?: NativeFolderReference;
}
export type SelectedFolder = FolderReference & { name: string };
/** Current runtime File plus its independently persisted reference. */
export type FileAccessSource = FileReference & { file?: File };
export interface FileReadOptions { prompt?: boolean }
export interface FolderReadOptions { maxDepth?: number; readConcurrency?: number }
export interface DiscoveredMediaFile {
  file: MediaFileAccess | null;
  parent: MediaDirectoryAccess | null;
  reference: FileReference;
  path: string;
  currentFile?: File;
}
export interface FolderDiscoveryOptions extends FolderReadOptions {
  onFileFound?: (file: DiscoveredMediaFile) => void;
}
export interface FilePickerOptions extends OpenFilePickerOptions { targetWindow?: Window | null }
export interface FolderPickerOptions { mode?: 'read' | 'readwrite'; targetWindow?: Window | null }
export interface SaveFileOptions { suggestedName: string; types?: FilePickerAcceptType[] }
export interface FileAccessContext {
  path?: string;
  sourceFolderId?: string;
  folders?: (FolderReference & { id: string; name: string })[];
}

export interface PlatformFilesystem {
  /** Presentation of the platform's grant model, independent of URI syntax. */
  accessModel: 'browser-grants' | 'os-permissions' | 'persisted-grants';
  supportsFilePicker(targetWindow?: Window | null): boolean;
  supportsFolderPicker(targetWindow?: Window | null): boolean;
  supportsWritableFolders(): boolean;
  preferSnapshotReads(size: number): boolean;
  pickFiles(options?: FilePickerOptions): Promise<File[]>;
  pickFolder(options?: FolderPickerOptions): Promise<SelectedFolder | null>;
  pickWritableFolder(): Promise<MediaDirectoryAccess | null>;
  pickSaveFile(options: SaveFileOptions): Promise<MediaFileAccess | null>;
  normalizeFileReference(value: unknown): FileReference;
  normalizeFolderReference(value: unknown): SelectedFolder | null;
  readFile(reference: FileAccessSource, options?: FileReadOptions): Promise<File | null>;
  prepareFileAccess(reference: FileReference): Promise<void>;
  readFolder(reference: FolderReference, options?: FolderReadOptions): Promise<File[]>;
  discoverFolder(reference: FolderReference, options?: FolderDiscoveryOptions): Promise<DiscoveredMediaFile[]>;
  queryFolderPermission(reference: FolderReference, probe?: boolean, timeoutMs?: number): Promise<NativeFolderPermission>;
  requestFolderPermission(reference: FolderReference): Promise<NativeFolderPermission>;
  sameFolder(first: FolderReference, second: FolderReference): Promise<boolean>;
  sameFile(first: FileReference, second: FileReference): Promise<boolean>;
  resolveFilePath(reference: FileReference, folder: FolderReference): Promise<string[] | null>;
  getMediaAccess(reference: FileReference, context?: FileAccessContext): Promise<{
    file: MediaFileAccess | null;
    parent: MediaDirectoryAccess | null;
  }>;
}

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
      && (uri.protocol === 'file:' ? /^file:\/\//i.test(value.uri) && uri.pathname.startsWith('/') : Boolean(uri.host));
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
    if (/%2f|%00/i.test(uri.pathname)
      || ((uri.host || /^\/[a-z]:\//i.test(uri.pathname)) && /%5c/i.test(uri.pathname))) return null;
    const path = decodeURIComponent(uri.pathname);
    return uri.host ? `//${uri.host}${path}` : /^\/[a-z]:\//i.test(path) ? path.slice(1) : path;
  } catch { return null; }
}
