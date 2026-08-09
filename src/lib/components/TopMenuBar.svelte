<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import { version as appVersion } from '../../../package.json';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import { applyManualLoadoutSettings } from '$lib/services/loadouts';
  import { pwaUpdateStatus } from '$lib/services/pwa-updates';
  import { loadouts } from '$lib/stores/loadouts';
  import type {
    MenuActionItem,
    VideoFitMode,
    WindowMenuGroup,
    WindowMenuSubtitleTone
  } from '$lib/types';
  import { getLoadoutColorValue, LOADOUT_TYPE_ICONS } from '$lib/utils/loadout-presentation';
  import { formatDisplayVersion } from '$lib/utils/version';
  import type { OptionsViewName } from '../../options/views';
  import type {
    MultiplayerClient,
    MultiplayerAudioStatus,
    MultiplayerConnectionStats,
    MultiplayerConnectionStatus,
    MultiplayerMode
  } from '$lib/services/multiplayer-session';
  import { MULTIPLAYER_PROTOCOL_VERSION } from '$lib/services/multiplayer-protocol';
  import type { MultiplayerConnectionRoute } from '$lib/services/multiplayer-ice';
  import type { MultiplayerRecent } from '$lib/stores/multiplayer-recents';
  import type { MultiplayerPairing } from '$lib/stores/multiplayer-pairings';

  type DispatchedMenuActionId =
    | 'openFiles'
    | 'openFolder'
    | 'installApp'
    | 'openOptions'
    | 'forceUpdate'
    | 'openAbout'
    | 'openAudioCompare'
    | 'openEditor'
    | 'openConverter'
    | 'openLogs'
    | 'openTroubadour'
    | 'showPlaylist'
    | 'showLibrary'
    | 'showTrackDetails'
    | 'showLyrics'
    | 'togglePatterns'
    | 'toggleMiniPlayer'
    | 'toggleNowPlayingView'
    | 'multiplayerHost'
    | 'multiplayerStopHosting'
    | 'multiplayerJoin'
    | 'multiplayerLeave'
    | 'multiplayerCopyInvite'
    | 'multiplayerResumeAudio'
    | 'exit';
  type MenuActionId =
    | DispatchedMenuActionId
    | 'manageFolders'
    | 'openLoadouts'
    | 'videoFitContain'
    | 'videoFitCover'
    | 'toggleVideoPictureInPicture'
    | 'toggleVideoTheater'
    | 'multiplayerToggleAudio'
    | `multiplayerKick:${string}`
    | `multiplayerTogglePair:${string}`
    | `multiplayerJoinPaired:${string}`
    | `multiplayerForgetPairing:${string}`
    | `multiplayerJoinRecent:${string}`
    | `applyLoadout:${string}`;

  $: multiplayerMenuItems = multiplayerMode === 'idle'
    ? [
        {
          id: 'multiplayerHost',
          label: $t('main.multiplayer.host', { default: 'Host' }),
          icon: 'cast'
        },
        {
          id: 'multiplayerJoin',
          label: $t('main.multiplayer.join', { default: 'Join...' }),
          icon: 'login'
        },
        {
          id: 'multiplayerFreeplayPreference',
          label: $t('main.multiplayer.freeplay.label', { default: 'Freeplay' }),
          description: multiplayerFreeplayEnabled
            ? $t('main.multiplayer.freeplay.preferenceEnabled', { default: 'Enabled for compatible pairings' })
            : $t('main.multiplayer.freeplay.preferenceDisabled', { default: 'Disabled in Options' }),
          icon: multiplayerFreeplayEnabled ? 'queue_music' : 'music_off',
          disabled: true,
          separatorBefore: true
        },
        ...(multiplayerPairings.length > 0
          ? [
              {
                id: 'multiplayerPairedHosts',
                label: $t('main.multiplayer.pairedHosts', { default: 'Paired hosts' }),
                icon: 'link',
                disabled: true,
                separatorBefore: true
              } satisfies MenuActionItem,
              ...multiplayerPairings.map((pairing) => ({
                id: `multiplayerJoinPaired:${pairing.hostId}`,
                label: pairing.name,
                description: pairing.freeplay
                  ? $t('main.multiplayer.freeplay.pairedHost', { default: 'Freeplay · Join without a code' })
                  : $t('main.multiplayer.instantJoin', { default: 'Join without a code' }),
                icon: pairing.freeplay ? 'queue_music' : 'cast_connected',
                removeActionId: `multiplayerForgetPairing:${pairing.hostId}`,
                removeLabel: $t('main.multiplayer.forgetPairing', {
                  default: 'Forget pairing with {name}',
                  values: { name: pairing.name }
                })
              } satisfies MenuActionItem))
            ]
          : []),
        ...(multiplayerRecents.length > 0
          ? [
              {
                id: 'multiplayerRecents',
                label: $t('main.multiplayer.recents', { default: 'Recents' }),
                icon: 'history',
                disabled: true,
                separatorBefore: multiplayerPairings.length === 0
              } satisfies MenuActionItem,
              ...multiplayerRecents.map((recent) => ({
                id: `multiplayerJoinRecent:${recent.inviteCode}`,
                label: recent.name,
                description: recent.inviteCode,
                icon: 'cast'
              } satisfies MenuActionItem))
            ]
          : [])
      ] satisfies MenuActionItem[]
    : multiplayerMode === 'hosting'
      ? [
          {
            id: 'multiplayerStatus',
            label: $t('main.multiplayer.hosting', { default: 'Hosting' }),
            description: multiplayerInviteCode ?? undefined,
            icon: 'cast_connected',
            disabled: true
          },
          {
            id: 'multiplayerCopyInvite',
            label: $t('main.multiplayer.copyInvite', { default: 'Copy invite code' }),
            icon: 'content_copy'
          },
          {
            id: 'multiplayerStopHosting',
            label: $t('main.multiplayer.stopHosting', { default: 'Stop hosting' }),
            icon: 'stop_circle'
          },
          {
            id: 'multiplayerFreeplayPreference',
            label: $t('main.multiplayer.freeplay.label', { default: 'Freeplay' }),
            description: multiplayerFreeplayEnabled
              ? $t('main.multiplayer.freeplay.preferenceEnabled', { default: 'Enabled for compatible pairings' })
              : $t('main.multiplayer.freeplay.preferenceDisabled', { default: 'Disabled in Options' }),
            icon: multiplayerFreeplayEnabled ? 'queue_music' : 'music_off',
            disabled: true,
            separatorBefore: true
          },
          ...multiplayerClients.map((client, index): MenuActionItem => ({
            id: `multiplayerTogglePair:${client.id}`,
            label: client.name,
            description: client.paired
              ? client.freeplay
                ? $t('main.multiplayer.freeplay.pairedClientActive', {
                    default: '{platform} · Paired · Freeplay',
                    values: { platform: client.platform }
                  })
                : client.freeplayPaired
                  ? $t('main.multiplayer.freeplay.pairedClientReady', {
                      default: '{platform} · Paired · Freeplay ready',
                      values: { platform: client.platform }
                    })
                  : $t('main.multiplayer.pairedClient', {
                      default: '{platform} · Paired',
                      values: { platform: client.platform }
                    })
              : $t('main.multiplayer.pairClient', {
                  default: '{platform} · Select to pair',
                  values: { platform: client.platform }
                }),
            icon: client.paired ? 'link' : client.status === 'connected' ? 'smartphone' : 'signal_disconnected',
            disabled: client.status !== 'connected',
            separatorBefore: index === 0,
            removeActionId: `multiplayerKick:${client.id}`,
            removeLabel: $t('main.multiplayer.kick', {
              default: 'Kick {name}',
              values: { name: client.name }
            })
          }))
        ] satisfies MenuActionItem[]
      : [
          {
            id: 'multiplayerStatus',
            label: multiplayerConnectionStatus === 'connected'
              ? multiplayerHostName ?? $t('main.multiplayer.host', { default: 'Host' })
              : multiplayerConnectionStatus === 'connecting'
                ? $t('main.multiplayer.connecting', { default: 'Connecting...' })
                : $t('main.multiplayer.disconnected', { default: 'Disconnected' }),
            icon: multiplayerConnectionStatus === 'connected' ? 'cast_connected' : 'signal_disconnected',
            description: multiplayerConnectionStatus === 'connected'
              ? multiplayerAudioStatusLabel(multiplayerAudioStatus, multiplayerConnectionRoute, multiplayerAudioBitrateKbps)
              : undefined,
            disabled: true
          },
          {
            id: 'multiplayerFreeplayStatus',
            label: $t('main.multiplayer.freeplay.label', { default: 'Freeplay' }),
            description: multiplayerFreeplay
              ? $t('main.multiplayer.freeplay.active', { default: 'Independent host library playback' })
              : multiplayerFreeplayPaired
                ? $t('main.multiplayer.freeplay.inactive', { default: 'Paired; Freeplay is disabled on one device' })
                : $t('main.multiplayer.freeplay.unpaired', { default: 'Available after both devices enable it and pair' }),
            icon: multiplayerFreeplay ? 'queue_music' : 'music_off',
            disabled: true,
            separatorBefore: true
          },
          ...(multiplayerAudioStatus === 'blocked'
            ? [{
                id: 'multiplayerResumeAudio',
                label: $t('main.multiplayer.startListening', { default: 'Start listening' }),
                icon: 'play_circle'
              } satisfies MenuActionItem]
            : []),
          {
            id: 'multiplayerLeave',
            label: $t('main.multiplayer.leave', { default: 'Leave' }),
            icon: 'logout'
          }
        ] satisfies MenuActionItem[];

  $: sessionMenuItems = [
    ...multiplayerMenuItems,
    {
      id: 'multiplayerToggleAudio',
      label: $t('main.multiplayer.receiveAudio', { default: 'Receive audio' }),
      icon: multiplayerReceiveAudio ? 'check' : 'volume_off',
      checked: multiplayerReceiveAudio,
      separatorBefore: true
    },
    {
      id: 'multiplayerStatHostVersion',
      label: $t('main.multiplayer.stats.hostVersion', { default: 'Host izci' }),
      shortcut: multiplayerHostVersion ? `v${multiplayerHostVersion}` : '—',
      icon: 'info',
      disabled: true,
      separatorBefore: true
    },
    {
      id: 'multiplayerStatProtocol',
      label: $t('main.multiplayer.stats.protocol', { default: 'Protocol' }),
      shortcut: `v${MULTIPLAYER_PROTOCOL_VERSION}`,
      icon: 'lan',
      disabled: true
    },
    {
      id: 'multiplayerStatConnection',
      label: $t('main.multiplayer.stats.connection', { default: 'Connection' }),
      shortcut: formatConnectionStat(),
      icon: 'route',
      disabled: true
    },
    {
      id: 'multiplayerStatAudio',
      label: $t('main.multiplayer.stats.audio', { default: 'Audio' }),
      shortcut: formatAudioStat(),
      icon: 'graphic_eq',
      disabled: true
    },
    {
      id: 'multiplayerStatRecentLoss',
      label: $t('main.multiplayer.stats.loss30s', { default: 'Loss · 30 s' }),
      shortcut: formatPacketLoss(
        multiplayerConnectionStats?.recentPacketsLost,
        multiplayerConnectionStats?.recentPacketsReceived,
        multiplayerConnectionStats?.recentPacketLossPercent
      ),
      icon: 'network_check',
      disabled: true
    },
    {
      id: 'multiplayerStatTotalLoss',
      label: $t('main.multiplayer.stats.lossTotal', { default: 'Loss · total' }),
      shortcut: formatPacketLoss(
        multiplayerConnectionStats?.packetsLost,
        multiplayerConnectionStats?.packetsReceived,
        multiplayerConnectionStats?.packetLossPercent
      ),
      icon: 'monitoring',
      disabled: true
    },
    {
      id: 'multiplayerStatTiming',
      label: $t('main.multiplayer.stats.timing', { default: 'Jitter · RTT' }),
      shortcut: formatTimingStat(),
      icon: 'speed',
      disabled: true
    }
  ] satisfies MenuActionItem[];

  $: loadoutMenuItems = [
    {
      id: 'openLoadouts',
      label: $t('main.menu.openLoadouts', { default: 'Open loadouts' }),
      icon: 'bookmark_manager'
    },
    ...$loadouts.loadouts.map((loadout, index) => ({
      id: `applyLoadout:${loadout.id}`,
      label: loadout.name,
      icon: LOADOUT_TYPE_ICONS[loadout.target.type],
      iconColor: getLoadoutColorValue(loadout.color),
      separatorBefore: index === 0
    }))
  ] satisfies MenuActionItem[];
  $: appMenuItems = [
    ...(installAvailable
      ? [{
          id: 'installApp',
          label: $t('main.menu.installApp', { default: 'Install izci...' }),
          description: showInstallHint || installHintPresentedInOpenMenu
            ? $t('main.menu.installDescription', {
                default: 'Install the PWA to get file associations, a compact title bar, better OS integration and automatic updates.'
              })
            : undefined,
          icon: 'install_desktop',
          attention: showInstallHint || installHintPresentedInOpenMenu
        } satisfies MenuActionItem]
      : []),
    {
      id: 'openOptions',
      label: $t('main.menu.options', { default: 'Options...' }),
      icon: 'settings',
      shortcut: 'Ctrl+P',
      separatorBefore: installAvailable
    },
    {
      id: 'loadouts',
      label: $t('main.menu.loadouts', { default: 'Loadouts' }),
      icon: 'bookmarks',
      children: loadoutMenuItems
    },
    ...(multiplayerEnabled
      ? [{
          id: 'multiplayer',
          label: $t('main.multiplayer.label', { default: 'Multiplayer' }),
          icon: 'cast',
          children: multiplayerMenuItems
        } satisfies MenuActionItem]
      : []),
    {
      id: 'openTroubadour',
      label: $t('main.menu.troubadour', { default: 'Troubadour...' }),
      icon: 'library_music',
      separatorBefore: true
    },
    {
      id: 'openAudioCompare',
      label: $t('main.menu.audioCompare', { default: 'Audio Compare...' }),
      icon: 'compare_arrows'
    },
    {
      id: 'openEditor',
      label: $t('main.menu.editor', { default: 'Editor...' }),
      icon: 'content_cut'
    },
    {
      id: 'openConverter',
      label: $t('main.menu.converter', { default: 'Converter...' }),
      icon: 'sync_alt'
    },
    {
      id: 'openLogs',
      label: $t('main.menu.logs', { default: 'Logs...' }),
      icon: 'article'
    },
    {
      id: 'openAbout',
      label: $t('main.menu.about', { default: 'About' }),
      icon: 'info',
      separatorBefore: true
    },
    {
      id: 'exit',
      label: $t('main.menu.exit', { default: 'Exit' }),
      icon: 'logout',
      shortcut: 'Ctrl+Q'
    }
  ] satisfies MenuActionItem[];
  $: fileMenuItems = [
    {
      id: 'openFiles',
      label: $t('main.menu.openFiles', { default: 'Open files...' }),
      icon: 'file_open',
      shortcut: 'Ctrl+O'
    },
    {
      id: 'openFolder',
      label: $t('main.menu.openFolder', { default: 'Open folder...' }),
      icon: 'folder_open'
    },
    {
      id: 'manageFolders',
      label: $t('main.menu.manageFolders', { default: 'Manage folders...' }),
      icon: 'folder_copy',
      separatorBefore: true
    }
  ] satisfies MenuActionItem[];
  $: helpMenuItems = [
    {
      id: 'forceUpdate',
      label: $t('main.menu.forceUpdate', { default: 'Force update' }),
      icon: 'sync'
    }
  ] satisfies MenuActionItem[];

  export let nowPlayingViewActive = false;
  export let miniPlayerSupported = false;
  export let miniPlayerActive = false;
  export let videoActive = false;
  export let videoFitMode: VideoFitMode = 'contain';
  export let videoPictureInPictureSupported = false;
  export let videoTheaterActive = false;
  export let installAvailable = false;
  export let showInstallHint = false;
  export let height = 0;
  export let multiplayerEnabled = false;
  export let multiplayerMode: MultiplayerMode = 'idle';
  export let multiplayerConnectionStatus: MultiplayerConnectionStatus = 'idle';
  export let multiplayerReconnecting = false;
  export let multiplayerAudioStatus: MultiplayerAudioStatus = 'idle';
  export let multiplayerConnectionRoute: MultiplayerConnectionRoute | null = null;
  export let multiplayerAudioBitrateKbps: number | null = null;
  export let multiplayerInviteCode: string | null = null;
  export let multiplayerHostName: string | null = null;
  export let multiplayerHostVersion: string | null = null;
  export let multiplayerFreeplayEnabled = false;
  export let multiplayerFreeplayPaired = false;
  export let multiplayerFreeplay = false;
  export let multiplayerReceiveAudio = true;
  export let multiplayerConnectionStats: MultiplayerConnectionStats | null = null;
  export let multiplayerClients: MultiplayerClient[] = [];
  export let multiplayerRecents: MultiplayerRecent[] = [];
  export let multiplayerPairings: MultiplayerPairing[] = [];
  const displayVersion = formatDisplayVersion(appVersion);

  const dispatch = createEventDispatcher<{
    openFiles: void;
    openFolder: void;
    installApp: void;
    acknowledgeInstallHint: void;
    openOptions: { view?: OptionsViewName } | undefined;
    forceUpdate: void;
    openAbout: void;
    openAudioCompare: void;
    openEditor: void;
    openConverter: void;
    openLogs: void;
    openTroubadour: void;
    showPlaylist: void;
    showLibrary: void;
    showTrackDetails: void;
    showLyrics: void;
    togglePatterns: void;
    toggleMiniPlayer: void;
    toggleNowPlayingView: void;
    multiplayerHost: void;
    multiplayerStopHosting: void;
    multiplayerJoin: void;
    multiplayerJoinRecent: string;
    multiplayerJoinPaired: string;
    multiplayerForgetPairing: string;
    multiplayerLeave: void;
    multiplayerCopyInvite: void;
    multiplayerResumeAudio: void;
    multiplayerToggleAudio: boolean;
    multiplayerKick: string;
    multiplayerTogglePair: string;
    setVideoFit: VideoFitMode;
    toggleVideoPictureInPicture: void;
    toggleVideoTheater: void;
    exit: void;
  }>();
  let installHintPresentedInOpenMenu = false;
  let menuSubtitleTone: WindowMenuSubtitleTone = 'muted';

  function multiplayerAudioStatusLabel(status: MultiplayerAudioStatus, route: MultiplayerConnectionRoute | null, bitrateKbps: number | null): string {
    const stateLabel = status === 'playing'
      ? $t('main.multiplayer.audio.listening', { default: 'Listening' })
      : status === 'blocked'
        ? $t('main.multiplayer.audio.blocked', { default: 'Audio needs permission' })
        : status === 'refused'
          ? $t('main.multiplayer.audio.refused', { default: 'Audio refused' })
        : status === 'disabled'
          ? $t('main.multiplayer.audio.disabled', { default: 'Host audio is off' })
          : status === 'unavailable'
              ? $t('main.multiplayer.audio.unavailable', { default: 'Audio unavailable' })
              : $t('main.multiplayer.audio.connecting', { default: 'Audio connecting...' });
    const routeLabel = route === 'direct'
      ? $t('main.multiplayer.route.direct', { default: 'Direct' })
      : route === 'relayed'
        ? $t('main.multiplayer.route.relayed', { default: 'Relayed' })
        : null;
    return [stateLabel, routeLabel, status === 'playing' && bitrateKbps !== null ? `${bitrateKbps} kbps` : null]
      .filter(Boolean)
      .join(' · ');
  }

  function formatConnectionStat(): string {
    const route = multiplayerConnectionRoute === 'direct'
      ? $t('main.multiplayer.route.direct', { default: 'Direct' })
      : multiplayerConnectionRoute === 'relayed'
        ? $t('main.multiplayer.route.relayed', { default: 'Relayed' })
        : null;
    return [multiplayerConnectionStatus, route].filter(Boolean).join(' · ') || '—';
  }

  function formatAudioStat(): string {
    if (!multiplayerReceiveAudio) return $t('main.multiplayer.audio.refused', { default: 'Refused' });
    return [
      multiplayerConnectionStats?.codec,
      multiplayerAudioBitrateKbps === null ? null : `${multiplayerAudioBitrateKbps} kbps`
    ].filter(Boolean).join(' · ') || '—';
  }

  function formatPacketLoss(lost?: number, received?: number, percent?: number | null): string {
    if (lost === undefined || received === undefined) return '—';
    return `${lost} / ${received + lost}${percent === null || percent === undefined ? '' : ` · ${percent}%`}`;
  }

  function formatTimingStat(): string {
    const jitter = multiplayerConnectionStats?.jitterMs;
    const rtt = multiplayerConnectionStats?.roundTripTimeMs;
    return `${jitter === null || jitter === undefined ? '—' : `${jitter} ms`} · ${rtt === null || rtt === undefined ? '—' : `${rtt} ms`}`;
  }

  $: viewMenuItems = [
    {
      id: 'showPlaylist',
      label: $t('main.menu.playlist', { default: 'Playlist' }),
      icon: 'queue_music'
    },
    {
      id: 'showLibrary',
      label: $t('main.menu.library', { default: 'Library' }),
      icon: 'library_music'
    },
    {
      id: 'showTrackDetails',
      label: $t('main.menu.trackDetails', { default: 'Track Details' }),
      icon: 'info'
    },
    {
      id: 'showLyrics',
      label: $t('main.menu.lyrics', { default: 'Lyrics' }),
      icon: 'lyrics'
    },
    {
      id: 'togglePatterns',
      label: $t('main.menu.patterns', { default: 'Patterns' }),
      icon: 'view_timeline'
    },
    ...(miniPlayerSupported
      ? [{
          id: 'toggleMiniPlayer',
          label: $t('main.menu.miniPlayer', { default: 'Mini player' }),
          icon: miniPlayerActive ? 'check' : 'picture_in_picture_alt',
          shortcut: 'Ctrl+M',
          separatorBefore: true
        } satisfies MenuActionItem]
      : []),
    {
      id: 'toggleNowPlayingView',
      label: $t('main.menu.nowPlaying', { default: 'Now Playing' }),
      icon: nowPlayingViewActive ? 'check' : 'album'
    }
  ] satisfies MenuActionItem[];
  $: videoMenuItems = [
    {
      id: 'videoFitContain',
      label: $t('main.video.fit', { default: 'Fit to window' }),
      icon: videoFitMode === 'contain' ? 'check' : 'fit_screen'
    },
    {
      id: 'videoFitCover',
      label: $t('main.video.fill', { default: 'Fill window' }),
      icon: videoFitMode === 'cover' ? 'check' : 'crop_free'
    },
    ...(videoPictureInPictureSupported
      ? [{
          id: 'toggleVideoPictureInPicture',
          label: $t('main.video.pictureInPicture', { default: 'Picture in Picture' }),
          icon: 'picture_in_picture_alt',
          separatorBefore: true
        } satisfies MenuActionItem]
      : []),
    {
      id: 'toggleVideoTheater',
      label: videoTheaterActive
        ? $t('main.player.exitVideoTheater', { default: 'Exit video theater' })
        : $t('main.player.enterVideoTheater', { default: 'Enter video theater' }),
      icon: videoTheaterActive ? 'check' : 'fit_screen',
      separatorBefore: !videoPictureInPictureSupported
    }
  ] satisfies MenuActionItem[];
  $: menuGroups = [
    {
      id: 'app',
      label: $t('main.menu.applicationMenu', { default: 'Application menu' }),
      items: appMenuItems,
      application: true,
      attention: showInstallHint
    },
    ...(multiplayerMode === 'client'
      ? [{
          id: 'session',
          label: $t('main.multiplayer.session', { default: 'Session' }),
          icon: 'cast_connected',
          items: sessionMenuItems
        } satisfies WindowMenuGroup]
      : [{
          id: 'file',
          label: $t('main.menu.file', { default: 'File' }),
          icon: 'folder',
          items: fileMenuItems
        } satisfies WindowMenuGroup]
    ),
    {
      id: 'view',
      label: $t('main.menu.view', { default: 'View' }),
      icon: 'visibility',
      items: viewMenuItems
    },
    ...(videoActive
      ? [{
          id: 'video',
          label: $t('main.video.menu', { default: 'Video' }),
          icon: 'movie',
          items: videoMenuItems
        } satisfies WindowMenuGroup]
      : []),
    {
      id: 'help',
      label: $t('main.menu.help', { default: 'Help' }),
      icon: 'help',
      items: helpMenuItems
    }
  ] satisfies WindowMenuGroup[];
  $: menuSubtitle = $pwaUpdateStatus === 'updated'
    ? $t('main.menu.updateUpdated', { default: 'updated!' })
    : $pwaUpdateStatus === 'up-to-date'
      ? $t('main.menu.updateCurrent', { default: 'up to date' })
      : $pwaUpdateStatus === 'failed'
        ? $t('main.menu.updateFailed', { default: 'update check failed' })
        : displayVersion;
  $: menuSubtitleTone =
    $pwaUpdateStatus === 'updated'
      ? 'success'
      : $pwaUpdateStatus === 'up-to-date'
        ? 'current'
        : $pwaUpdateStatus === 'failed'
          ? 'warning'
          : 'muted';

  function runMenuAction(action: MenuActionId) {
    if (action === 'multiplayerToggleAudio') {
      dispatch('multiplayerToggleAudio', !multiplayerReceiveAudio);
      return;
    }
    if (action === 'openLoadouts') {
      dispatch('openOptions', { view: 'loadouts' });
      return;
    }
    if (action === 'manageFolders') {
      dispatch('openOptions', { view: 'folders' });
      return;
    }
    if (action.startsWith('applyLoadout:')) {
      const loadoutId = action.slice('applyLoadout:'.length);
      const loadout = loadouts.getSnapshot().loadouts.find((candidate) => candidate.id === loadoutId);
      if (loadout) {
        applyManualLoadoutSettings(loadout.settings);
      }
      return;
    }
    if (action.startsWith('multiplayerKick:')) {
      dispatch('multiplayerKick', action.slice('multiplayerKick:'.length));
      return;
    }
    if (action.startsWith('multiplayerTogglePair:')) {
      dispatch('multiplayerTogglePair', action.slice('multiplayerTogglePair:'.length));
      return;
    }
    if (action.startsWith('multiplayerJoinPaired:')) {
      dispatch('multiplayerJoinPaired', action.slice('multiplayerJoinPaired:'.length));
      return;
    }
    if (action.startsWith('multiplayerForgetPairing:')) {
      dispatch('multiplayerForgetPairing', action.slice('multiplayerForgetPairing:'.length));
      return;
    }
    if (action.startsWith('multiplayerJoinRecent:')) {
      dispatch('multiplayerJoinRecent', action.slice('multiplayerJoinRecent:'.length));
      return;
    }
    if (action === 'videoFitContain' || action === 'videoFitCover') {
      dispatch('setVideoFit', action === 'videoFitContain' ? 'contain' : 'cover');
      return;
    }
    if (action === 'toggleVideoPictureInPicture') {
      dispatch('toggleVideoPictureInPicture');
      return;
    }
    if (action === 'toggleVideoTheater') {
      dispatch('toggleVideoTheater');
      return;
    }
    dispatch(action as DispatchedMenuActionId);
  }
</script>

<WindowMenuBar
  bind:height
  groups={menuGroups}
  title="izci"
  mainWorkspace={true}
  subtitle={menuSubtitle}
  subtitleTone={menuSubtitleTone}
  ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
  multiplayerConnectionTone={multiplayerMode !== 'client'
    ? 'none'
    : multiplayerConnectionStatus === 'connected'
      ? multiplayerConnectionRoute === 'relayed' ? 'relayed' : 'connected'
      : multiplayerReconnecting
        ? 'reconnecting'
      : 'disconnected'}
  on:menuopen={(event) => {
    if (event.detail === 'app' && showInstallHint) {
      installHintPresentedInOpenMenu = true;
      dispatch('acknowledgeInstallHint');
    }
  }}
  on:menuclose={() => installHintPresentedInOpenMenu = false}
  on:action={(event) => runMenuAction(event.detail as MenuActionId)}
/>
