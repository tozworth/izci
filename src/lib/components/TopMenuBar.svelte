<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import { version as appVersion } from '../../../package.json';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import { applyManualLoadoutSettings } from '$lib/services/loadouts';
  import { pwaUpdateStatus } from '$lib/services/pwa-updates';
  import { loadouts } from '$lib/stores/loadouts';
  import { normalizePlaybackRate, playbackSettings } from '$lib/stores/playback-settings';
  import { isRafPresetDirty, rafPresets } from '$lib/stores/raf-presets';
  import { rafSettings } from '$lib/stores/raf-settings';
  import {
    addPlaybackBookmark,
    deletePlaybackBookmark,
    getPlaybackBookmarkFileKey,
    getPlaybackBookmarks,
    type PlaybackBookmark
  } from '$lib/services/playback-bookmarks';
  import { formatDuration } from '$lib/utils/files';
  import {
    cancelSleepTimer,
    setSleepTimer,
    sleepTimer,
    SLEEP_TIMER_PRESET_MINUTES
  } from '$lib/services/sleep-timer';
  import {
    abLoop,
    clearAbLoop,
    setAbLoopEnd,
    setAbLoopStart
  } from '$lib/services/ab-loop';
  import type {
    MenuActionItem,
    TrackItem,
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
  } from '$lib/services/multiplayer-types';
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
    | 'showQueue'
    | 'showLibrary'
    | 'showTrackDetails'
    | 'showLyrics'
    | 'togglePatterns'
    | 'toggleMiniPlayer'
    | 'toggleNowPlayingView'
    | 'multiplayerHost'
    | 'multiplayerHostWithCode'
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
    | 'openRaf'
    | 'toggleTrueSpeed'
    | 'toggleRaf'
    | 'toggleStopAfterTrack'
    | 'sleepTimerOff'
    | `sleepTimerSet:${string}`
    | `setPlaybackRate:${string}`
    | `applyRafPreset:${string}`
    | 'bookmark:add'
    | `bookmark:delete:${string}`
    | `bookmark:seek:${string}`
    | 'abLoopSetStart'
    | 'abLoopSetEnd'
    | 'abLoopClear'
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

  const PLAYBACK_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

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
            description: multiplayerInviteCode
              ?? $t('main.multiplayer.hostingForPaired', { default: 'For paired devices' }),
            icon: 'cast_connected',
            disabled: true
          },
          ...(multiplayerInviteCode
            ? [{
                id: 'multiplayerCopyInvite',
                label: $t('main.multiplayer.copyInvite', { default: 'Copy invite code' }),
                icon: 'content_copy'
              } satisfies MenuActionItem]
            : [{
                id: 'multiplayerHostWithCode',
                label: $t('main.multiplayer.hostWithCode', { default: 'Host with invite code' }),
                icon: 'add_link'
              } satisfies MenuActionItem]),
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
      shortcut: multiplayerHostVersion
        ? `v${multiplayerHostVersion} · ${$t('main.multiplayer.stats.protocol', { default: 'Protocol' })} ${MULTIPLAYER_PROTOCOL_VERSION}`
        : '—',
      icon: 'info',
      disabled: true,
      separatorBefore: true
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
      id: 'multiplayerStatData',
      label: $t('main.multiplayer.stats.data', { default: 'Data' }),
      shortcut: formatBytes(multiplayerConnectionStats?.bytesReceived),
      icon: 'data_usage',
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
  $: playbackSpeedMenuItems = [
    {
      id: 'toggleTrueSpeed',
      label: $t('options.playback.trueSpeed.title', { default: 'True speed' }),
      icon: 'speed',
      checked: $playbackSettings.trueSpeed
    },
    ...PLAYBACK_SPEED_OPTIONS.map((rate, index) => ({
      id: `setPlaybackRate:${rate}`,
      label: $t('main.menu.speedPreset', { default: '{rate}×', values: { rate: String(rate) } }),
      icon: 'speed',
      checked: $playbackSettings.playbackRate === rate,
      separatorBefore: index === 0
    }))
  ] satisfies MenuActionItem[];
  $: rafMenuItems = [
    {
      id: 'toggleRaf',
      label: $rafSettings.enabled
        ? $t('main.player.bypassRaf', { default: 'Bypass Raf' })
        : $t('main.menu.enableRaf', { default: 'Enable Raf' }),
      icon: 'power_settings_new'
    },
    {
      id: 'openRaf',
      label: $t('main.player.openRaf', { default: 'Open Raf' }),
      icon: 'tune'
    },
    ...($rafPresets.presets.length > 0
      ? $rafPresets.presets.map((preset, index) => ({
          id: `applyRafPreset:${preset.id}`,
          label: `${preset.name}${preset.id === $rafPresets.selectedPresetId && isRafPresetDirty($rafPresets, $rafSettings) ? ' *' : ''}`,
          icon: 'tune',
          checked: preset.id === $rafPresets.selectedPresetId,
          separatorBefore: index === 0
        }) satisfies MenuActionItem)
      : [{
          id: 'rafNoPresets',
          label: $t('main.player.noRafPresets', { default: 'No Raf presets' }),
          icon: 'tune',
          disabled: true,
          separatorBefore: true
        } satisfies MenuActionItem])
  ] satisfies MenuActionItem[];
  $: bookmarkTrackKey = playingTrack ? getPlaybackBookmarkFileKey(playingTrack) : null;
  $: if (bookmarkTrackKey !== loadedBookmarkTrackKey) {
    loadedBookmarkTrackKey = bookmarkTrackKey;
    bookmarks = playingTrack ? getPlaybackBookmarks(playingTrack) : [];
  }
  $: bookmarksMenuItems = [
    ...bookmarks.map((bookmark): MenuActionItem => ({
      id: `bookmark:seek:${bookmark.id}`,
      label: bookmark.name,
      shortcut: formatDuration(bookmark.time),
      icon: 'bookmark',
      removeActionId: `bookmark:delete:${bookmark.id}`,
      removeLabel: $t('main.player.deleteBookmark', {
        default: 'Delete bookmark {name}',
        values: { name: bookmark.name }
      })
    })),
    {
      id: 'bookmark:add',
      label: $t('main.player.addBookmark', { default: 'Add bookmark' }),
      icon: 'bookmark_add',
      separatorBefore: bookmarks.length > 0
    }
  ] satisfies MenuActionItem[];
  $: sleepTimerMenuItems = [
    {
      id: 'sleepTimerOff',
      label: $t('main.menu.sleepTimerOff', { default: 'Off' }),
      icon: 'timer_off',
      checked: !$sleepTimer.active
    },
    ...SLEEP_TIMER_PRESET_MINUTES.map((minutes, index) => ({
      id: `sleepTimerSet:${minutes}`,
      label: $t('main.menu.sleepTimerMinutes', { default: '{minutes} min', values: { minutes: String(minutes) } }),
      icon: 'timer',
      checked: $sleepTimer.active && $sleepTimer.durationMinutes === minutes,
      separatorBefore: index === 0
    }))
  ] satisfies MenuActionItem[];
  $: playbackMenuItems = [
    {
      id: 'sleepTimer',
      label: $t('main.menu.sleepTimer', { default: 'Sleep timer' }),
      description: $sleepTimer.active && $sleepTimer.remainingSeconds !== null
        ? $t('main.menu.sleepTimerRemaining', {
            default: 'Stops in {time}',
            values: { time: formatDuration($sleepTimer.remainingSeconds) }
          })
        : undefined,
      icon: 'bedtime',
      children: sleepTimerMenuItems
    },
    {
      id: 'toggleStopAfterTrack',
      label: $t('main.menu.stopAfterTrack', { default: 'Stop after current track' }),
      icon: 'stop',
      checked: $playbackSettings.stopAfterTrack
    },
    {
      id: 'playbackSpeed',
      label: $t('options.playback.playbackRate.title', { default: 'Playback speed' }),
      icon: 'speed',
      separatorBefore: true,
      children: playbackSpeedMenuItems
    },
    {
      id: 'bookmarks',
      label: $t('main.player.bookmarks', { default: 'Bookmarks' }),
      icon: 'bookmarks',
      disabled: !playingTrack,
      children: bookmarksMenuItems
    },
    {
      id: $abLoop.start === null
        ? 'abLoopSetStart'
        : $abLoop.end === null
          ? 'abLoopSetEnd'
          : 'abLoopClear',
      label: $abLoop.start === null
        ? $t('main.menu.abLoopSetStart', { default: 'Set A-B start' })
        : $abLoop.end === null
          ? $t('main.menu.abLoopSetEnd', { default: 'Set A-B end' })
          : $t('main.menu.abLoopStop', { default: 'Stop A-B loop' }),
      description: $abLoop.active && $abLoop.start !== null && $abLoop.end !== null
        ? $t('main.menu.abLoopActive', {
            default: 'Looping {start}–{end}',
            values: { start: formatDuration($abLoop.start), end: formatDuration($abLoop.end) }
          })
        : undefined,
      icon: $abLoop.end === null ? 'flag' : 'repeat',
      checked: $abLoop.active,
      disabled: !playingTrack
    },
    {
      id: 'raf',
      label: $t('options.views.raf', { default: 'Raf' }),
      icon: 'tune',
      children: rafMenuItems
    }
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
      id: 'exit',
      label: $t('main.menu.exit', { default: 'Exit' }),
      icon: 'logout',
      shortcut: 'Ctrl+Q',
      separatorBefore: true
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
      id: 'openLogs',
      label: $t('main.menu.logs', { default: 'Logs...' }),
      icon: 'article'
    },
    {
      id: 'forceUpdate',
      label: $t('main.menu.forceUpdate', { default: 'Force update' }),
      icon: 'sync'
    },
    {
      id: 'openAbout',
      label: $t('main.menu.about', { default: 'About' }),
      icon: 'info',
      separatorBefore: true
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
  export let playingTrack: TrackItem | null = null;
  export let playbackTime = 0;
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
    showQueue: void;
    showLibrary: void;
    showTrackDetails: void;
    showLyrics: void;
    togglePatterns: void;
    toggleMiniPlayer: void;
    toggleNowPlayingView: void;
    multiplayerHost: void;
    multiplayerHostWithCode: void;
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
    seek: number;
    exit: void;
  }>();
  let installHintPresentedInOpenMenu = false;
  let menuSubtitleTone: WindowMenuSubtitleTone = 'muted';
  let bookmarks: PlaybackBookmark[] = [];
  let loadedBookmarkTrackKey: string | null = null;

  function multiplayerAudioStatusLabel(status: MultiplayerAudioStatus, route: MultiplayerConnectionRoute | null, bitrateKbps: number | null): string {
    const stateLabel = status === 'playing'
      ? $t('main.multiplayer.audio.listening', { default: 'Listening' })
      : status === 'ready'
        ? $t('main.multiplayer.audio.ready', { default: 'Audio ready' })
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

  function formatBytes(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let scaled = value;
    let unit = 0;
    while (scaled >= 1000 && unit < units.length - 1) {
      scaled /= 1000;
      unit += 1;
    }
    return `${scaled >= 100 || unit === 0 ? Math.round(scaled) : Math.round(scaled * 10) / 10} ${units[unit]}`;
  }

  function formatTimingStat(): string {
    const jitter = multiplayerConnectionStats?.jitterMs;
    const rtt = multiplayerConnectionStats?.roundTripTimeMs;
    return `${jitter === null || jitter === undefined ? '—' : `${jitter} ms`} · ${rtt === null || rtt === undefined ? '—' : `${rtt} ms`}`;
  }

  $: viewMenuItems = [
    {
      id: 'showQueue',
      label: $t('main.menu.queue', { default: 'Queue' }),
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
    {
      id: 'playback',
      label: $t('options.views.playback', { default: 'Playback' }),
      icon: 'play_circle',
      items: playbackMenuItems
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
    if (action === 'toggleTrueSpeed') {
      playbackSettings.update({ trueSpeed: !playbackSettings.getSnapshot().trueSpeed });
      return;
    }
    if (action === 'toggleStopAfterTrack') {
      playbackSettings.update({ stopAfterTrack: !playbackSettings.getSnapshot().stopAfterTrack });
      return;
    }
    if (action === 'sleepTimerOff') {
      cancelSleepTimer();
      return;
    }
    if (action.startsWith('sleepTimerSet:')) {
      setSleepTimer(Number(action.slice('sleepTimerSet:'.length)));
      return;
    }
    if (action.startsWith('setPlaybackRate:')) {
      playbackSettings.update({
        playbackRate: normalizePlaybackRate(Number(action.slice('setPlaybackRate:'.length)))
      });
      return;
    }
    if (action === 'toggleRaf') {
      rafSettings.setEnabled(!rafSettings.getSnapshot().enabled);
      return;
    }
    if (action === 'openRaf') {
      dispatch('openOptions', { view: 'raf' });
      return;
    }
    if (action.startsWith('applyRafPreset:')) {
      rafPresets.apply(action.slice('applyRafPreset:'.length));
      return;
    }
    if (action === 'bookmark:add') {
      if (!playingTrack) return;
      const name = window.prompt($t('main.player.bookmarkNamePrompt', { default: 'Name this bookmark:' }));
      if (name === null) return;
      bookmarks = addPlaybackBookmark(playingTrack, playbackTime, name);
      return;
    }
    if (action.startsWith('bookmark:delete:')) {
      if (!playingTrack) return;
      bookmarks = deletePlaybackBookmark(playingTrack, action.slice('bookmark:delete:'.length));
      return;
    }
    if (action.startsWith('bookmark:seek:')) {
      if (!playingTrack) return;
      const bookmark = bookmarks.find(({ id }) => id === action.slice('bookmark:seek:'.length));
      if (bookmark) dispatch('seek', bookmark.time);
      return;
    }
    if (action === 'abLoopSetStart') {
      if (!playingTrack) return;
      setAbLoopStart(playbackTime);
      return;
    }
    if (action === 'abLoopSetEnd') {
      if (!playingTrack) return;
      setAbLoopEnd(playbackTime);
      return;
    }
    if (action === 'abLoopClear') {
      clearAbLoop();
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
