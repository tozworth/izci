export async function queryMetadataWritePermission(
  handle: FileSystemFileHandle
): Promise<FileSystemPermissionState> {
  if (!handle.createWritable) return 'denied';
  if (!handle.queryPermission) return 'granted';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/** Must only be called from a direct user activation. */
export async function requestMetadataWritePermission(
  handle: FileSystemFileHandle
): Promise<FileSystemPermissionState> {
  if (!handle.createWritable) return 'denied';
  if (!handle.requestPermission) return queryMetadataWritePermission(handle);
  try {
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}
