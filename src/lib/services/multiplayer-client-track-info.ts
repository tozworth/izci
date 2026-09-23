import { registerRemoteTrackLyrics } from './lyrics';
import { sendToPeer } from './multiplayer-peer';
import type { MultiplayerCatalog, MultiplayerPlayback, MultiplayerTrackInfo } from './multiplayer-protocol';
import type { MultiplayerClientContext } from './multiplayer-client';
import type { TrackItem } from '$lib/types';

export function enrichTrack(track: TrackItem, info: MultiplayerTrackInfo | undefined): TrackItem {
  return info && track.id === info.trackId
    ? { ...track, metadata: { ...track.metadata, ...info.metadata } }
    : track;
}

export function enrichCatalog(catalog: MultiplayerCatalog, infoById: Map<string, MultiplayerTrackInfo>): MultiplayerCatalog {
  const enrich = (items: TrackItem[]) => items.map((item) => enrichTrack(item, infoById.get(item.id)));
  return { ...catalog, queue: enrich(catalog.queue), library: enrich(catalog.library), favorites: enrich(catalog.favorites) };
}

export function enrichPlayback(playback: MultiplayerPlayback, infoById: Map<string, MultiplayerTrackInfo>): MultiplayerPlayback {
  return playback.track
    ? { ...playback, track: enrichTrack(playback.track, infoById.get(playback.track.id)) }
    : playback;
}

export function applyRemoteTrackInfo(ctx: MultiplayerClientContext, info: MultiplayerTrackInfo): void {
  const { core } = ctx;
  const track = [
    ...core.state.remoteCatalog.queue,
    ...core.state.remoteCatalog.library,
    ...core.state.remoteCatalog.favorites,
    core.state.remotePlayback.track
  ].find((item) => item?.id === info.trackId);
  if (!track) return;
  ctx.trackInfoById.set(info.trackId, info);
  if (info.lyrics) registerRemoteTrackLyrics(track, info.lyrics);
  core.publish({
    remoteCatalog: enrichCatalog(core.state.remoteCatalog, ctx.trackInfoById),
    remotePlayback: enrichPlayback(core.state.remotePlayback, ctx.trackInfoById)
  });
}

export function requestRemoteTrackInfo(ctx: MultiplayerClientContext, trackId: string): void {
  const { core } = ctx;
  if (core.state.mode !== 'client'
    || core.state.connectionStatus !== 'connected'
    || !core.state.hostProtocol?.capabilities.includes('track-info')
    || !core.clientPeer?.channel
    || core.clientPeer.channel.readyState !== 'open'
    || ctx.requestedTrackInfo.has(trackId)) return;
  ctx.requestedTrackInfo.add(trackId);
  sendToPeer(core.clientPeer, { kind: 'track.info.request', trackId });
}
