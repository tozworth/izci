// Android's FSA-backed ranged reads have a high fixed cost. Desktop Chromium
// and WebView2 keep File URLs disk-backed and should not copy media into RAM.
export const ANDROID_FILE_SNAPSHOT_MAX_BYTES = 16 * 1024 * 1024;

export function useAndroidFileSnapshot(size: number): boolean {
  return size > 0 && size <= ANDROID_FILE_SNAPSHOT_MAX_BYTES
    && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}
