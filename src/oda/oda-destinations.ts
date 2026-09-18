/**
 * Pure Oda media selectors and the static home destination model.
 *
 * Counts are derived from the effective library collection Oda receives (host
 * catalog for a Multiplayer client) and never touch the persisted desktop
 * `libraryViewSettings`.
 */

import { countLibraryGroups } from '$lib/components/track-list-panel/library-views';
import type { TrackItem } from '$lib/types';
import type { OdaRoute } from '$lib/services/oda-session';
import type { MultiplayerSessionState } from '$lib/services/multiplayer-types';
import type { MultiplayerPairing } from '$lib/stores/multiplayer-pairings';
import type { MultiplayerRecent } from '$lib/stores/multiplayer-recents';

export function isOdaMusicTrack(track: TrackItem): boolean {
  return track.kind === 'stream' || track.kind === 'module';
}

export function isOdaVideoTrack(track: TrackItem): boolean {
  return track.kind === 'video';
}

export function isOdaImageTrack(track: TrackItem): boolean {
  return track.kind === 'image';
}

export function selectOdaMusic(items: readonly TrackItem[]): TrackItem[] {
  return items.filter(isOdaMusicTrack);
}

export function selectOdaVideos(items: readonly TrackItem[]): TrackItem[] {
  return items.filter(isOdaVideoTrack);
}

export function selectOdaImages(items: readonly TrackItem[]): TrackItem[] {
  return items.filter(isOdaImageTrack);
}

/** Recently played library items only: finite `lastPlayed`, newest first. */
export function selectOdaRecents(items: readonly TrackItem[]): TrackItem[] {
  return items
    .filter((item) => {
      const lastPlayed = item.metadata?.lastPlayed;
      return typeof lastPlayed === 'number' && Number.isFinite(lastPlayed);
    })
    .sort((left, right) => (right.metadata!.lastPlayed! - left.metadata!.lastPlayed!));
}

export interface OdaMediaCounts {
  music: number;
  videos: number;
  images: number;
  recents: number;
  artists: number;
  albums: number;
  songs: number;
  genres: number;
  years: number;
  formats: number;
  folders: number;
}

export function resolveOdaMediaCounts(items: readonly TrackItem[]): OdaMediaCounts {
  const music = selectOdaMusic(items);
  return {
    music: music.length,
    videos: selectOdaVideos(items).length,
    images: selectOdaImages(items).length,
    recents: selectOdaRecents(items).length,
    artists: countLibraryGroups(music, 'artists'),
    albums: countLibraryGroups(music, 'albums'),
    songs: music.length,
    genres: countLibraryGroups(music, 'genres'),
    years: countLibraryGroups(music, 'years'),
    formats: countLibraryGroups(music, 'formats'),
    folders: countLibraryGroups(music, 'folders')
  };
}

/** Resolve the kind-appropriate presentation route for the current item. */
export function resolveNowPlayingRoute(_track: TrackItem | null): OdaRoute {
  return { name: 'now-playing' };
}

export type OdaCardCommand =
  | 'exit-oda'
  | 'multiplayer-host'
  | 'multiplayer-stop-hosting'
  | 'multiplayer-join'
  | 'multiplayer-leave'
  | 'multiplayer-join-paired'
  | 'multiplayer-join-recent';

export interface OdaCardModel {
  /** Stable logical focus ID. */
  id: string;
  labelKey: string;
  labelFallback: string;
  /** Literal label for user-provided names. */
  label?: string;
  count?: number;
  route?: OdaRoute;
  command?: OdaCardCommand;
  commandValue?: string;
  /** Optional live status shown below the card label. */
  meta?: string;
  metaKey?: string;
  metaFallback?: string;
  metaValues?: Record<string, string | number>;
  /** Destination currently has no items; still focusable with an empty state. */
  empty?: boolean;
}

export interface OdaMultiplayerHomeState {
  enabled: boolean;
  session: MultiplayerSessionState;
  pairings: readonly MultiplayerPairing[];
  recents: readonly MultiplayerRecent[];
}

export interface OdaHomeSectionModel {
  id: string;
  labelKey: string;
  labelFallback: string;
  cards: OdaCardModel[];
}

function musicCard(
  id: string,
  labelKey: string,
  labelFallback: string,
  view: 'artists' | 'albums' | 'songs' | 'genres' | 'years' | 'formats' | 'folders',
  count: number
): OdaCardModel {
  return {
    id,
    labelKey,
    labelFallback,
    count,
    empty: count === 0,
    route: { name: 'browse', medium: 'music', view }
  };
}

export function buildOdaHomeSections(
  counts: OdaMediaCounts,
  multiplayer?: OdaMultiplayerHomeState
): OdaHomeSectionModel[] {
  const sections: OdaHomeSectionModel[] = [
    {
      id: 'images',
      labelKey: 'oda.home.images',
      labelFallback: 'Images',
      cards: [{
        id: 'browse-images',
        labelKey: 'oda.cards.browseImages',
        labelFallback: 'Browse images',
        count: counts.images,
        empty: counts.images === 0,
          route: { name: 'browse', medium: 'image', view: 'songs' }
      }]
    },
    {
      id: 'videos',
      labelKey: 'oda.home.videos',
      labelFallback: 'Videos',
      cards: [{
        id: 'browse-videos',
        labelKey: 'oda.cards.browseVideos',
        labelFallback: 'Browse videos',
        count: counts.videos,
        empty: counts.videos === 0,
          route: { name: 'browse', medium: 'video', view: 'songs' }
      }]
    },
    {
      id: 'music',
      labelKey: 'oda.home.music',
      labelFallback: 'Music',
      cards: [
        {
          id: 'browse-music',
          labelKey: 'oda.cards.browseMusic',
          labelFallback: 'Browse music',
          count: counts.music,
          empty: counts.music === 0,
          route: { name: 'browse', medium: 'music', view: 'songs' }
        },
        musicCard('artists', 'oda.cards.artists', 'Artists', 'artists', counts.artists),
        musicCard('albums', 'oda.cards.albums', 'Albums', 'albums', counts.albums),
        musicCard('songs', 'oda.cards.songs', 'Songs', 'songs', counts.songs),
        musicCard('genres', 'oda.cards.genres', 'Genres', 'genres', counts.genres),
        musicCard('years', 'oda.cards.years', 'Years', 'years', counts.years),
        musicCard('formats', 'oda.cards.formats', 'Formats', 'formats', counts.formats),
        musicCard('folders', 'oda.cards.folders', 'Folders', 'folders', counts.folders)
      ]
    },
    {
      id: 'now-playing',
      labelKey: 'oda.home.nowPlaying',
      labelFallback: 'Now Playing',
      cards: [
        {
          id: 'now-playing',
          labelKey: 'oda.cards.nowPlaying',
          labelFallback: 'Now Playing'
        },
        {
          id: 'queue',
          labelKey: 'oda.cards.queue',
          labelFallback: 'Queue'
        }
      ]
    },
    {
      id: 'recents',
      labelKey: 'oda.home.recents',
      labelFallback: 'Recents',
      cards: [{
        id: 'browse-recents',
        labelKey: 'oda.cards.browseRecents',
        labelFallback: 'Browse recently played',
        count: counts.recents,
        empty: counts.recents === 0,
        route: { name: 'recents' }
      }]
    },
  ];

  if (multiplayer?.enabled) {
    const { session, pairings, recents } = multiplayer;
    const connectedClients = session.clients.filter((client) => client.status === 'connected').length;
    sections.push({
      id: 'multiplayer',
      labelKey: 'oda.home.multiplayer',
      labelFallback: 'Multiplayer',
      cards: [
        {
          id: 'multiplayer-host',
          labelKey: session.mode === 'hosting'
            ? 'oda.cards.stopHosting'
            : 'oda.cards.host',
          labelFallback: session.mode === 'hosting' ? 'Stop hosting' : 'Host',
          command: session.mode === 'hosting'
            ? 'multiplayer-stop-hosting'
            : 'multiplayer-host',
          metaKey: session.mode === 'hosting'
            ? session.inviteCode
              ? 'oda.multiplayer.hostStatus'
              : 'oda.multiplayer.clientCount'
            : undefined,
          metaFallback: session.mode === 'hosting'
            ? session.inviteCode
              ? '{code} · {count, plural, one {# client} other {# clients}}'
              : '{count, plural, one {# client} other {# clients}}'
            : undefined,
          metaValues: session.mode === 'hosting'
            ? { code: session.inviteCode ?? '', count: connectedClients }
            : undefined
        },
        {
          id: 'multiplayer-join',
          labelKey: session.mode === 'client'
            ? 'oda.cards.leave'
            : 'oda.cards.join',
          labelFallback: session.mode === 'client' ? 'Leave' : 'Join',
          command: session.mode === 'client'
            ? 'multiplayer-leave'
            : 'multiplayer-join',
          meta: session.mode === 'client' ? session.hostName ?? undefined : undefined
        },
        ...pairings.map((pairing): OdaCardModel => ({
          id: `multiplayer-paired-${pairing.hostId}`,
          labelKey: 'oda.cards.pairedHost',
          labelFallback: 'Paired host',
          label: pairing.name,
          command: 'multiplayer-join-paired',
          commandValue: pairing.hostId,
          metaKey: 'oda.cards.pairedHost',
          metaFallback: 'Paired host'
        })),
        ...recents.map((recent): OdaCardModel => ({
          id: `multiplayer-recent-${recent.inviteCode}`,
          labelKey: 'oda.cards.recentHost',
          labelFallback: 'Recent host',
          label: recent.name,
          command: 'multiplayer-join-recent',
          commandValue: recent.inviteCode,
          metaKey: 'oda.cards.recentHost',
          metaFallback: 'Recent host'
        }))
      ]
    });
  }

  sections.push(
    {
      id: 'options',
      labelKey: 'oda.home.options',
      labelFallback: 'Options',
      cards: [
        {
          id: 'all-options',
          labelKey: 'oda.cards.allOptions',
          labelFallback: 'All options',
          route: { name: 'options', view: 'oda' }
        },
        {
          id: 'exit-oda',
          labelKey: 'oda.cards.exitOda',
          labelFallback: 'Exit Oda',
          command: 'exit-oda'
        }
      ]
    }
  );

  return sections;
}
