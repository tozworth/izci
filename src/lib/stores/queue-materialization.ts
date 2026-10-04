import { inferExtension, inferKind } from '$lib/utils/files';
import { logDebug, logWarning } from '$lib/services/logging';
import type { TrackItem } from '$lib/types';
import { resolveTrackFile, createTrackMediaUrl } from '$lib/services/file-access';

export function revokeObjectUrl(item: Pick<TrackItem, 'objectUrl'>): void {
  if (item.objectUrl) {
    logDebug('files', 'Object URL revoked');
    URL.revokeObjectURL(item.objectUrl);
  }
}

export async function materializeTrackItem(item: TrackItem, prompt = false): Promise<TrackItem | null> {
  if (item.file && (item.kind === 'module' || item.objectUrl)) {
    logDebug('files', 'Track already materialized', { id: item.id, kind: item.kind });
    return item;
  }

  const file = await resolveTrackFile(item, { prompt });
  if (!file) {
    logWarning('files', 'Track access is unavailable', { id: item.id, prompt });
    return null;
  }

  const extension = inferExtension(file.name);
  const kind = inferKind(extension) ?? (item.kind === 'module' ? 'module' : null);

  if (!kind) {
    logWarning('files', 'Materialized file has unsupported extension', { id: item.id, extension });
    return null;
  }

  const objectUrl = await createTrackMediaUrl(kind, file);
  logDebug('files', 'Track materialized', { id: item.id, kind, bytes: file.size, objectUrl: Boolean(objectUrl) });
  return {
    ...item,
    file,
    name: file.name,
    extension,
    kind,
    size: file.size,
    lastModified: file.lastModified,
    objectUrl
  };
}
