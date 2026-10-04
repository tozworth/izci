import { nativeFilePath, type NativeFileReference } from '$lib/services/platform-files-types';

/** Keep Windows drive/UNC paths opaque to the shared collection code. */
export function desktopFileReference(path: string): NativeFileReference {
  const normalized = path.replaceAll('\\', '/');
  if (/^[a-z]:\//i.test(normalized)) {
    return { uri: `file:///${normalized.slice(0, 2)}/${normalized.slice(3).split('/').map(encodeURIComponent).join('/')}` };
  }
  const unc = /^\/\/([^/]+)\/(.+)$/.exec(normalized);
  if (unc) return { uri: `file://${unc[1]}/${unc[2].split('/').map(encodeURIComponent).join('/')}` };
  throw new Error('Desktop file references require an absolute drive or UNC path.');
}

export function desktopFilePath(reference: NativeFileReference): string {
  const path = nativeFilePath(reference);
  if (!path) throw new Error('Invalid desktop file reference.');
  return path;
}
