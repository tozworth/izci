export async function queryHandlePermission(
  handle: FileSystemHandle, mode: 'read' | 'readwrite' = 'read'
): Promise<FileSystemPermissionState> {
  if (!handle.queryPermission) return 'granted';
  try { return await handle.queryPermission({ mode }); } catch { return 'prompt'; }
}

/** Call directly from user activation, before IndexedDB or other awaited work. */
export async function requestHandlePermission(
  handle: FileSystemHandle, mode: 'read' | 'readwrite' = 'read'
): Promise<FileSystemPermissionState> {
  if (!handle.requestPermission) return 'granted';
  try { return await handle.requestPermission({ mode }); } catch { return 'denied'; }
}

export async function sameHandle(first: FileSystemHandle, second: FileSystemHandle): Promise<boolean> {
  if (first === second) return true;
  try { return await first.isSameEntry?.(second) ?? false; } catch { return false; }
}
