import { getCachedArtworkThumbnail } from '$lib/services/artwork-cache';
import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
import type { PlaylistItem } from '$lib/types';
import type { MultiplayerArtwork } from './multiplayer-protocol';

export const MULTIPLAYER_ARTWORK_MAX_EDGE = 1024;

export function getMultiplayerArtworkTrackKey(track: PlaylistItem | null): string {
  if (!track) return '';
  return [track.id, track.extension, track.size, track.lastModified].join(':');
}

export async function loadMultiplayerArtwork(
  track: PlaylistItem | null
): Promise<MultiplayerArtwork | null> {
  if (!track) return null;

  const rendition = await getCachedArtworkThumbnail(track, MULTIPLAYER_ARTWORK_MAX_EDGE);
  if (!rendition) return null;

  return {
    trackId: track.id,
    assetId: rendition.assetId,
    dataUrl: await blobToDataUrl(rendition.blob),
    mimeType: rendition.blob.type || 'image/webp',
    width: rendition.width,
    height: rendition.height
  };
}

export function getRemoteArtworkLoadKey(
  track: PlaylistItem | null,
  artwork: MultiplayerArtwork | null,
  resolvedTrackKey: string
): string {
  if (!track) return '';

  const trackKey = getMultiplayerArtworkTrackKey(track);
  if (resolvedTrackKey !== trackKey) {
    return resolvedTrackKey
      ? artwork
        ? `${resolvedTrackKey}:${artwork.assetId}`
        : `${resolvedTrackKey}:no-artwork`
      : '';
  }

  return artwork?.trackId === track.id
    ? `${trackKey}:${artwork.assetId}`
    : `${trackKey}:no-artwork`;
}

export function toLoadedMultiplayerArtwork(
  track: PlaylistItem | null,
  artwork: MultiplayerArtwork | null
): LoadedStreamArtwork | null {
  if (!track || !artwork || artwork.trackId !== track.id) return null;

  return {
    url: artwork.dataUrl,
    mediaImage: {
      src: artwork.dataUrl,
      sizes: `${artwork.width}x${artwork.height}`,
      type: artwork.mimeType
    }
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Artwork could not be encoded.'));
    reader.onerror = () => reject(reader.error ?? new Error('Artwork could not be encoded.'));
    reader.readAsDataURL(blob);
  });
}
