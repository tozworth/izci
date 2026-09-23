import { materializeTrackItem } from '$lib/stores/queue-materialization';
import { loadTrackLyrics } from '$lib/services/lyrics';
import { loadTrackMetadata } from '$lib/services/stream-artwork';
import type { TrackItem, TrackMetadata } from '$lib/types';
import { sendToPeer } from './multiplayer-peer';
import type { MultiplayerHostContext } from './multiplayer-host';
import type { PeerConnection } from './multiplayer-types';
import type { MultiplayerTrackInfo } from './multiplayer-protocol';

const MAX_METADATA_BYTES = 32 * 1024;
const MAX_LYRICS_LENGTH = 64 * 1024;

function findHostTrack(ctx: MultiplayerHostContext, id: string): TrackItem | null {
  const source = ctx.core.latestHostState;
  if (!source) return null;
  return [...source.queue, ...source.library, ...source.favorites].find((item) => item.id === id)
    ?? (source.track?.id === id ? source.track : null);
}

export async function readBrowserHostTrackInfo(track: TrackItem): Promise<MultiplayerTrackInfo> {
  const loaded = await materializeTrackItem(track, false).catch(() => null);
  return readLoadedTrackInfo(loaded ?? track);
}

export async function readLoadedTrackInfo(fileTrack: TrackItem): Promise<MultiplayerTrackInfo> {
  const [embedded, lyrics] = await Promise.all([
    loadTrackMetadata(fileTrack).catch(() => null),
    loadTrackLyrics(fileTrack).catch(() => null)
  ]);
  const metadata: TrackMetadata = { ...fileTrack.metadata, ...embedded };
  if (JSON.stringify(metadata).length > MAX_METADATA_BYTES) {
    return { trackId: fileTrack.id, metadata: fileTrack.metadata ?? {}, lyrics: null };
  }
  return {
    trackId: fileTrack.id,
    metadata,
    lyrics: lyrics && lyrics.raw.length <= MAX_LYRICS_LENGTH ? lyrics.raw : null
  };
}

export function sendBrowserHostTrackInfo(ctx: MultiplayerHostContext, peer: PeerConnection, trackId: string): void {
  const track = findHostTrack(ctx, trackId);
  if (!track) return;
  void readBrowserHostTrackInfo(track).then((info) => {
    if (ctx.core.hostPeers.get(peer.id) !== peer || peer.channel?.readyState !== 'open') return;
    sendToPeer(peer, { kind: 'track.info', info });
  });
}
