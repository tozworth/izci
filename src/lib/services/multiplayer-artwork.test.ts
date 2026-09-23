import { describe, expect, it } from 'vitest';
import type { TrackItem } from '$lib/types';
import type { MultiplayerArtwork } from './multiplayer-protocol';
import {
  getMultiplayerArtworkTrackKey,
  getRemoteDetailsLoadKey,
  getRemoteArtworkLoadKey
} from './multiplayer-artwork';

function item(id: string): TrackItem {
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind: 'stream',
    size: 1,
    lastModified: 1
  };
}

function artwork(trackId: string, assetId: string): MultiplayerArtwork {
  return {
    trackId,
    assetId,
    dataUrl: 'data:image/webp;base64,AA==',
    mimeType: 'image/webp',
    width: 1,
    height: 1
  };
}

describe('multiplayer artwork presentation', () => {
  it('keeps the previous artwork key while the next track artwork is unresolved', () => {
    const previousTrack = item('previous');
    const nextTrack = item('next');
    const previousArtwork = artwork('previous', 'asset-one');
    const previousResolvedKey = getMultiplayerArtworkTrackKey(previousTrack);

    expect(getRemoteArtworkLoadKey(previousTrack, previousArtwork, previousResolvedKey))
      .toBe(`${previousResolvedKey}:asset-one`);
    expect(getRemoteArtworkLoadKey(nextTrack, previousArtwork, previousResolvedKey))
      .toBe(`${previousResolvedKey}:asset-one`);
  });

  it('switches to the next artwork or confirmed theme fallback only after resolution', () => {
    const nextTrack = item('next');
    const nextResolvedKey = getMultiplayerArtworkTrackKey(nextTrack);

    expect(getRemoteArtworkLoadKey(nextTrack, artwork('next', 'asset-two'), nextResolvedKey))
      .toBe(`${nextResolvedKey}:asset-two`);
    expect(getRemoteArtworkLoadKey(nextTrack, null, nextResolvedKey))
      .toBe(`${nextResolvedKey}:no-artwork`);
  });

  it('keeps Details keyed to the selected track instead of the playing artwork', () => {
    const selectedTrack = item('selected');
    const selectedKey = getMultiplayerArtworkTrackKey(selectedTrack);

    expect(getRemoteDetailsLoadKey(selectedTrack, artwork('playing', 'asset-one')))
      .toBe(`${selectedKey}:no-artwork`);
    expect(getRemoteDetailsLoadKey(selectedTrack, artwork('selected', 'asset-two')))
      .toBe(`${selectedKey}:asset-two`);
  });
});
