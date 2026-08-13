import type { MediaEntity } from './catalog';
import type { TrackMetadata } from './media-metadata';

export interface BackupManifest {
  kind: 'izci-backup';
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  sourceOrigin: string;
  contents: {
    settings: number;
    libraryTracks: number;
    folders: number;
    favorites: number;
    playbackProgress: number;
  };
}

export interface PortableTrackRecord {
  id: string;
  name: string;
  format: string;
  kind: MediaEntity['kind'];
  size: number;
  lastModified: number;
  path: string;
  sourceFolderId?: string;
  metadata?: TrackMetadata;
  rating?: number;
  subsong?: number;
}

export interface PortableFolderRecord {
  id: string;
  name: string;
  addedAt: number;
  libraryMode: 'manual' | 'launch' | null;
}

export interface PendingBackupRestore {
  createdAt: string;
  sourceOrigin: string;
  folders: PortableFolderRecord[];
  tracks: PortableTrackRecord[];
  favorites: PortableTrackRecord[];
}

export interface BackupRestoreResult {
  manifest: BackupManifest;
  settingsRestored: number;
  tracksMatched: number;
  tracksPending: number;
  foldersPending: number;
  favoritesRestored: number;
  progressRestored: number;
}

export interface LocateRestoreResult {
  status: 'success' | 'mismatch';
  matchedTracks: number;
  remainingTracks: number;
}
