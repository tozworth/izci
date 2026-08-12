import type { PlaylistItem } from '$lib/contracts/catalog';
import type { TrackKind } from '$lib/contracts/media-format';

const REQUEST_MESSAGE = 'izci:request-tool-track';
export const OPEN_CURRENT_TOOL_TRACK_MESSAGE = 'izci:open-current-tool-track';
const TRACK_MESSAGE = 'izci:tool-track';

export interface ToolTrackContext {
  file: File;
  fileHandle?: FileSystemFileHandle;
  path?: string;
  extension: string;
  kind: TrackKind;
}

function normalizeToolTrackContext(value: unknown): ToolTrackContext | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ToolTrackContext>;

  if (
    !(source.file instanceof File)
    || typeof source.extension !== 'string'
    || (source.kind !== 'stream' && source.kind !== 'module' && source.kind !== 'video')
  ) {
    return null;
  }

  return {
    file: source.file,
    fileHandle: source.fileHandle,
    path: typeof source.path === 'string' ? source.path : undefined,
    extension: source.extension,
    kind: source.kind
  };
}

function toToolTrackContext(track: PlaylistItem | null): ToolTrackContext | null {
  if (!track?.file) return null;

  return {
    file: track.file,
    fileHandle: track.fileHandle,
    path: track.path,
    extension: track.extension,
    kind: track.kind
  };
}

function postTrack(target: Window, track: ToolTrackContext | null, targetOrigin: string): void {
  try {
    target.postMessage({ type: TRACK_MESSAGE, track }, targetOrigin);
  } catch {
    // FileSystem handles are structured-cloneable in Chromium, but keep read-only
    // tool loading available if a partial implementation rejects the handle.
    target.postMessage({
      type: TRACK_MESSAGE,
      track: track ? { ...track, fileHandle: undefined } : null
    }, targetOrigin);
  }
}

export function respondToToolTrackRequest(
  event: MessageEvent,
  track: PlaylistItem | null
): boolean {
  if (
    event.origin !== window.location.origin
    || event.data?.type !== REQUEST_MESSAGE
    || !event.source
  ) {
    return false;
  }

  postTrack(event.source as Window, toToolTrackContext(track), event.origin);
  return true;
}

export function listenForCurrentToolTrack(
  onTrack: (track: ToolTrackContext) => void
): () => void {
  const requestTrack = () => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: REQUEST_MESSAGE }, window.location.origin);
    }
  };
  const handleMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== window.opener) return;

    if (event.data?.type === OPEN_CURRENT_TOOL_TRACK_MESSAGE) {
      requestTrack();
      return;
    }

    if (event.data?.type !== TRACK_MESSAGE) return;
    const track = normalizeToolTrackContext(event.data.track);
    if (track) onTrack(track);
  };

  window.addEventListener('message', handleMessage);
  requestTrack();

  return () => window.removeEventListener('message', handleMessage);
}
