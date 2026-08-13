import type { TrackKind } from './media-format';
import type { TrackMetadata } from './media-metadata';

export type PlaylistRepeatMode = 'off' | 'one' | 'all';

export interface PlaylistItem {
  id: string;
  file?: File;
  fileHandle?: FileSystemFileHandle;
  path?: string;
  sourceFolderId?: string;
  name: string;
  extension: string;
  kind: TrackKind;
  size: number;
  lastModified: number;
  objectUrl?: string;
  metadata?: TrackMetadata;
  /** App-owned half-star rating from 0.5 through 5. */
  rating?: number;
  /** Zero-based module subsong selected by a separated playlist entry. */
  subsong?: number;
}

/** Durable catalog identity. Browser source objects belong to the media-source owner. */
export interface MediaEntity {
  readonly id: string;
  /** Canonical persisted and display path, always normalized to forward slashes. */
  readonly path: string;
  readonly name: string;
  /** Lowercase file/container format. Unknown verified modules retain their source suffix. */
  readonly format: string;
  readonly kind: TrackKind;
  readonly size: number;
  readonly lastModified: number;
  readonly sourceFolderId?: string;
  readonly metadata?: TrackMetadata;
  /** App-owned half-star rating from 0.5 through 5. */
  readonly rating?: number;
  /** Zero-based module subsong selected by a separated catalog entity. */
  readonly subsong?: number;
}

export interface PlaylistSelection {
  ids: string[];
  anchorId: string | null;
  focusId: string | null;
}

export interface PlaylistPlaybackOptions {
  shuffle: boolean;
  repeatMode: PlaylistRepeatMode;
}
