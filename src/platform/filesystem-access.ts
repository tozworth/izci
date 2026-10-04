import type { NativeFolderPermission } from '$lib/services/platform-files-types';

export const FOLDER_ACCESS_TIMEOUT_MS = 3_000;

/** Access checks must settle even when a provider or stale handle stalls. */
export async function boundedFolderAccess(
  work: () => Promise<NativeFolderPermission>, timeoutMs = FOLDER_ACCESS_TIMEOUT_MS
): Promise<NativeFolderPermission> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<NativeFolderPermission>(resolve => { timer = setTimeout(() => resolve('unavailable'), timeoutMs); })
    ]);
  } catch { return 'unavailable'; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
