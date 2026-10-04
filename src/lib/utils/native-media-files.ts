const mediaUrls = new WeakMap<File, string>();

/** Native files expose bytes through the shell, without a whole-file Blob copy. */
export function registerNativeMediaUrl(file: File, url: string): void { mediaUrls.set(file, url); }
export function getNativeMediaUrl(file: File): string | undefined { return mediaUrls.get(file); }
export function createMediaFileUrl(file: File): string { return getNativeMediaUrl(file) ?? URL.createObjectURL(file); }

/** A document can be selected directly or addressed under a granted tree. */
export function nativeFileIdentity(uri: string): string {
  try {
    const parsed = new URL(uri);
    const marker = '/document/';
    const index = parsed.pathname.lastIndexOf(marker);
    if (index >= 0) return `${parsed.host}/document/${decodeURIComponent(parsed.pathname.slice(index + marker.length))}`;
  } catch { /* Keep opaque provider references intact. */ }
  return uri;
}
