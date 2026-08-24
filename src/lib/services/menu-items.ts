import { version as appVersion } from '../../../package.json';
import { type PwaUpdateStatus } from '$lib/services/pwa-updates';
import { isRafPresetDirty } from '$lib/stores/raf-presets';
import {
  getPlaybackBookmarks,
  type PlaybackBookmark
} from '$lib/services/playback-bookmarks';
import { formatDuration } from '$lib/utils/files';
import {
  SLEEP_TIMER_PRESET_MINUTES,
  type SleepTimerState
} from '$lib/services/sleep-timer';
import { type AbLoopState } from '$lib/services/ab-loop';
import type {
  LoadoutState,
  MenuActionItem,
  PlaybackSettings,
  RafPresetState,
  RafRackSettings,
  TrackItem,
  VideoFitMode,
  WindowMenuGroup
} from '$lib/types';
import { getLoadoutColorValue, LOADOUT_TYPE_ICONS } from '$lib/utils/loadout-presentation';
import { formatDisplayVersion } from '$lib/utils/version';
import type { MultiplayerClient, MultiplayerAudioStatus, MultiplayerConnectionStats, MultiplayerConnectionStatus, MultiplayerMode } from '$lib/services/multiplayer-types';
import { MULTIPLAYER_PROTOCOL_VERSION } from '$lib/services/multiplayer-protocol';
import type { MultiplayerConnectionRoute } from '$lib/services/multiplayer-ice';
import type { MultiplayerRecent } from '$lib/stores/multiplayer-recents';
import type { MultiplayerPairing } from '$lib/stores/multiplayer-pairings';
import {
  formatMultiplayerAudioStatusLabel,
  formatConnectionStat,
  formatAudioStat,
  formatPacketLoss,
  formatBytes,
  formatTimingStat,
  type MenuTranslation
} from '$lib/services/menu-format';

const PLAYBACK_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface MenuItemsDeps {
  translate: MenuTranslation;
  multiplayerMode: MultiplayerMode;
  multiplayerFreeplayEnabled: boolean;
  multiplayerPairings: MultiplayerPairing[];
  multiplayerRecents: MultiplayerRecent[];
  multiplayerInviteCode: string | null;
  multiplayerClients: MultiplayerClient[];
  multiplayerConnectionStatus: MultiplayerConnectionStatus;
  multiplayerHostName: string | null;
  multiplayerAudioStatus: MultiplayerAudioStatus;
  multiplayerConnectionRoute: MultiplayerConnectionRoute | null;
  multiplayerAudioBitrateKbps: number | null;
  multiplayerFreeplay: boolean;
  multiplayerFreeplayPaired: boolean;
  multiplayerReceiveAudio: boolean;
  multiplayerHostVersion: string | null;
  multiplayerConnectionStats: MultiplayerConnectionStats | null;
  multiplayerEnabled: boolean;
  playingTrack: TrackItem | null;
  installAvailable: boolean;
  showInstallHint: boolean;
  installHintPresentedInOpenMenu: boolean;
  miniPlayerSupported: boolean;
  miniPlayerActive: boolean;
  nowPlayingViewActive: boolean;
  videoActive: boolean;
  videoFitMode: VideoFitMode;
  videoPictureInPictureSupported: boolean;
  videoTheaterActive: boolean;
  pwaUpdateStatus: PwaUpdateStatus;
  playbackSettings: PlaybackSettings;
  rafSettings: RafRackSettings;
  abLoop: AbLoopState;
  sleepTimer: SleepTimerState;
  loadouts: LoadoutState;
  rafPresets: RafPresetState;
}

interface MenuItemsResult {
  menuGroups: WindowMenuGroup[];
  menuSubtitle: string;
}

export function buildMenuItems(deps: MenuItemsDeps): MenuItemsResult {
  const multiplayerMenuItems = buildMultiplayerMenuItems(deps);
  const sessionMenuItems = buildSessionMenuItems(deps, multiplayerMenuItems);
  const loadoutMenuItems = buildLoadoutMenuItems(deps);
  const playbackSpeedMenuItems = buildPlaybackSpeedMenuItems(deps);
  const rafMenuItems = buildRafMenuItems(deps);
  const bookmarksMenuItems = buildBookmarksMenuItems(deps.playingTrack, deps.translate);
  const sleepTimerMenuItems = buildSleepTimerMenuItems(deps);
  const playbackMenuItems = buildPlaybackMenuItems(deps, rafMenuItems, bookmarksMenuItems, sleepTimerMenuItems, playbackSpeedMenuItems);
  const appMenuItems = buildAppMenuItems(deps, multiplayerMenuItems, loadoutMenuItems);
  const fileMenuItems = buildFileMenuItems(deps);
  const viewMenuItems = buildViewMenuItems(deps);
  const videoMenuItems = buildVideoMenuItems(deps);
  const helpMenuItems = buildHelpMenuItems(deps);
  const menuGroups = buildMenuGroups(deps, appMenuItems, fileMenuItems, viewMenuItems, playbackMenuItems, videoMenuItems, helpMenuItems, sessionMenuItems);
  const menuSubtitle = buildMenuSubtitle(deps);

  return {
    menuGroups,
    menuSubtitle
  };
}

function buildMenuSubtitle(deps: MenuItemsDeps): string {
  return deps.pwaUpdateStatus === 'updated'
    ? deps.translate('main.menu.updateUpdated', { default: 'updated!' })
    : deps.pwaUpdateStatus === 'up-to-date'
      ? deps.translate('main.menu.updateCurrent', { default: 'up to date' })
      : deps.pwaUpdateStatus === 'failed'
        ? deps.translate('main.menu.updateFailed', { default: 'update check failed' })
        : formatDisplayVersion(appVersion);
}

function buildMultiplayerMenuItems(deps: MenuItemsDeps): MenuActionItem[] {
  if (deps.multiplayerMode === 'idle') {
    return [
      {
        id: 'multiplayerHost',
        label: deps.translate('main.multiplayer.host', { default: 'Host' }),
        icon: 'cast'
      },
      {
        id: 'multiplayerJoin',
        label: deps.translate('main.multiplayer.join', { default: 'Join...' }),
        icon: 'login'
      },
      {
        id: 'multiplayerFreeplayPreference',
        label: deps.translate('main.multiplayer.freeplay.label', { default: 'Freeplay' }),
        description: deps.multiplayerFreeplayEnabled
          ? deps.translate('main.multiplayer.freeplay.preferenceEnabled', { default: 'Enabled for compatible pairings' })
          : deps.translate('main.multiplayer.freeplay.preferenceDisabled', { default: 'Disabled in Options' }),
        icon: deps.multiplayerFreeplayEnabled ? 'queue_music' : 'music_off',
        disabled: true,
        separatorBefore: true
      },
      ...(deps.multiplayerPairings.length > 0
        ? [
            {
              id: 'multiplayerPairedHosts',
              label: deps.translate('main.multiplayer.pairedHosts', { default: 'Paired hosts' }),
              icon: 'link',
              disabled: true,
              separatorBefore: true
            } satisfies MenuActionItem,
            ...deps.multiplayerPairings.map((pairing) => ({
              id: `multiplayerJoinPaired:${pairing.hostId}`,
              label: pairing.name,
              description: pairing.freeplay
                ? deps.translate('main.multiplayer.freeplay.pairedHost', { default: 'Freeplay · Join without a code' })
                : deps.translate('main.multiplayer.instantJoin', { default: 'Join without a code' }),
              icon: pairing.freeplay ? 'queue_music' : 'cast_connected',
              removeActionId: `multiplayerForgetPairing:${pairing.hostId}`,
              removeLabel: deps.translate('main.multiplayer.forgetPairing', {
                default: 'Forget pairing with {name}',
                values: { name: pairing.name }
              })
            } satisfies MenuActionItem))
          ]
        : []),
      ...(deps.multiplayerRecents.length > 0
        ? [
            {
              id: 'multiplayerRecents',
              label: deps.translate('main.multiplayer.recents', { default: 'Recents' }),
              icon: 'history',
              disabled: true,
              separatorBefore: deps.multiplayerPairings.length === 0
            } satisfies MenuActionItem,
            ...deps.multiplayerRecents.map((recent) => ({
              id: `multiplayerJoinRecent:${recent.inviteCode}`,
              label: recent.name,
              description: recent.inviteCode,
              icon: 'cast'
            } satisfies MenuActionItem))
          ]
        : [])
    ] satisfies MenuActionItem[];
  }

  if (deps.multiplayerMode === 'hosting') {
    return [
      {
        id: 'multiplayerStatus',
        label: deps.translate('main.multiplayer.hosting', { default: 'Hosting' }),
        description: deps.multiplayerInviteCode
          ?? deps.translate('main.multiplayer.hostingForPaired', { default: 'For paired devices' }),
        icon: 'cast_connected',
        disabled: true
      },
      ...(deps.multiplayerInviteCode
        ? [{
            id: 'multiplayerCopyInvite',
            label: deps.translate('main.multiplayer.copyInvite', { default: 'Copy invite code' }),
            icon: 'content_copy'
          } satisfies MenuActionItem]
        : [{
            id: 'multiplayerHostWithCode',
            label: deps.translate('main.multiplayer.hostWithCode', { default: 'Host with invite code' }),
            icon: 'add_link'
          } satisfies MenuActionItem]),
      {
        id: 'multiplayerStopHosting',
        label: deps.translate('main.multiplayer.stopHosting', { default: 'Stop hosting' }),
        icon: 'stop_circle'
      },
      {
        id: 'multiplayerFreeplayPreference',
        label: deps.translate('main.multiplayer.freeplay.label', { default: 'Freeplay' }),
        description: deps.multiplayerFreeplayEnabled
          ? deps.translate('main.multiplayer.freeplay.preferenceEnabled', { default: 'Enabled for compatible pairings' })
          : deps.translate('main.multiplayer.freeplay.preferenceDisabled', { default: 'Disabled in Options' }),
        icon: deps.multiplayerFreeplayEnabled ? 'queue_music' : 'music_off',
        disabled: true,
        separatorBefore: true
      },
      ...deps.multiplayerClients.map((client, index): MenuActionItem => ({
        id: `multiplayerTogglePair:${client.id}`,
        label: client.name,
        description: client.paired
          ? client.freeplay
            ? deps.translate('main.multiplayer.freeplay.pairedClientActive', {
                default: '{platform} · Paired · Freeplay',
                values: { platform: client.platform }
              })
            : client.freeplayPaired
              ? deps.translate('main.multiplayer.freeplay.pairedClientReady', {
                  default: '{platform} · Paired · Freeplay ready',
                  values: { platform: client.platform }
                })
              : deps.translate('main.multiplayer.pairedClient', {
                  default: '{platform} · Paired',
                  values: { platform: client.platform }
                })
          : deps.translate('main.multiplayer.pairClient', {
              default: '{platform} · Select to pair',
              values: { platform: client.platform }
            }),
        icon: client.paired ? 'link' : client.status === 'connected' ? 'smartphone' : 'signal_disconnected',
        disabled: client.status !== 'connected',
        separatorBefore: index === 0,
        removeActionId: `multiplayerKick:${client.id}`,
        removeLabel: deps.translate('main.multiplayer.kick', {
          default: 'Kick {name}',
          values: { name: client.name }
        })
      }))
    ] satisfies MenuActionItem[];
  }

  return [
    {
      id: 'multiplayerStatus',
      label: deps.multiplayerConnectionStatus === 'connected'
        ? deps.multiplayerHostName ?? deps.translate('main.multiplayer.host', { default: 'Host' })
        : deps.multiplayerConnectionStatus === 'connecting'
          ? deps.translate('main.multiplayer.connecting', { default: 'Connecting...' })
          : deps.translate('main.multiplayer.disconnected', { default: 'Disconnected' }),
      icon: deps.multiplayerConnectionStatus === 'connected' ? 'cast_connected' : 'signal_disconnected',
      description: deps.multiplayerConnectionStatus === 'connected'
        ? formatMultiplayerAudioStatusLabel(deps.multiplayerAudioStatus, deps.multiplayerConnectionRoute, deps.multiplayerAudioBitrateKbps, deps.translate)
        : undefined,
      disabled: true
    },
    {
      id: 'multiplayerFreeplayStatus',
      label: deps.translate('main.multiplayer.freeplay.label', { default: 'Freeplay' }),
      description: deps.multiplayerFreeplay
        ? deps.translate('main.multiplayer.freeplay.active', { default: 'Independent host library playback' })
        : deps.multiplayerFreeplayPaired
          ? deps.translate('main.multiplayer.freeplay.inactive', { default: 'Paired; Freeplay is disabled on one device' })
          : deps.translate('main.multiplayer.freeplay.unpaired', { default: 'Available after both devices enable it and pair' }),
      icon: deps.multiplayerFreeplay ? 'queue_music' : 'music_off',
      disabled: true,
      separatorBefore: true
    },
    ...(deps.multiplayerAudioStatus === 'blocked'
      ? [{
          id: 'multiplayerResumeAudio',
          label: deps.translate('main.multiplayer.startListening', { default: 'Start listening' }),
          icon: 'play_circle'
        } satisfies MenuActionItem]
      : []),
    {
      id: 'multiplayerLeave',
      label: deps.translate('main.multiplayer.leave', { default: 'Leave' }),
      icon: 'logout'
    }
  ] satisfies MenuActionItem[];
}

function buildSessionMenuItems(deps: MenuItemsDeps, multiplayerMenuItems: MenuActionItem[]): MenuActionItem[] {
  return [
    ...multiplayerMenuItems,
    {
      id: 'multiplayerToggleAudio',
      label: deps.translate('main.multiplayer.receiveAudio', { default: 'Receive audio' }),
      icon: deps.multiplayerReceiveAudio ? 'check' : 'volume_off',
      checked: deps.multiplayerReceiveAudio,
      separatorBefore: true
    },
    {
      id: 'multiplayerStatHostVersion',
      label: deps.translate('main.multiplayer.stats.hostVersion', { default: 'Host izci' }),
      shortcut: deps.multiplayerHostVersion
        ? `v${deps.multiplayerHostVersion} · ${deps.translate('main.multiplayer.stats.protocol', { default: 'Protocol' })} ${MULTIPLAYER_PROTOCOL_VERSION}`
        : '—',
      icon: 'info',
      disabled: true,
      separatorBefore: true
    },
    {
      id: 'multiplayerStatConnection',
      label: deps.translate('main.multiplayer.stats.connection', { default: 'Connection' }),
      shortcut: formatConnectionStat(deps.multiplayerConnectionStatus, deps.multiplayerConnectionRoute, deps.translate),
      icon: 'route',
      disabled: true
    },
    {
      id: 'multiplayerStatAudio',
      label: deps.translate('main.multiplayer.stats.audio', { default: 'Audio' }),
      shortcut: formatAudioStat(deps.multiplayerReceiveAudio, deps.multiplayerConnectionStats, deps.multiplayerAudioBitrateKbps, deps.translate),
      icon: 'graphic_eq',
      disabled: true
    },
    {
      id: 'multiplayerStatData',
      label: deps.translate('main.multiplayer.stats.data', { default: 'Data' }),
      shortcut: formatBytes(deps.multiplayerConnectionStats?.bytesReceived),
      icon: 'data_usage',
      disabled: true
    },
    {
      id: 'multiplayerStatTotalLoss',
      label: deps.translate('main.multiplayer.stats.lossTotal', { default: 'Loss · total' }),
      shortcut: formatPacketLoss(
        deps.multiplayerConnectionStats?.packetsLost,
        deps.multiplayerConnectionStats?.packetsReceived,
        deps.multiplayerConnectionStats?.packetLossPercent
      ),
      icon: 'monitoring',
      disabled: true
    },
    {
      id: 'multiplayerStatTiming',
      label: deps.translate('main.multiplayer.stats.timing', { default: 'Jitter · RTT' }),
      shortcut: formatTimingStat(deps.multiplayerConnectionStats),
      icon: 'speed',
      disabled: true
    }
  ] satisfies MenuActionItem[];
}

function buildLoadoutMenuItems(deps: MenuItemsDeps): MenuActionItem[] {
  return [
    {
      id: 'openLoadouts',
      label: deps.translate('main.menu.openLoadouts', { default: 'Open loadouts' }),
      icon: 'bookmark_manager'
    },
    ...deps.loadouts.loadouts.map((loadout, index) => ({
      id: `applyLoadout:${loadout.id}`,
      label: loadout.name,
      icon: LOADOUT_TYPE_ICONS[loadout.target.type],
      iconColor: getLoadoutColorValue(loadout.color),
      separatorBefore: index === 0
    }))
  ] satisfies MenuActionItem[];
}

function buildPlaybackSpeedMenuItems(deps: MenuItemsDeps): MenuActionItem[] {
  return [
    {
      id: 'toggleTrueSpeed',
      label: deps.translate('options.playback.trueSpeed.title', { default: 'True speed' }),
      icon: 'speed',
      checked: deps.playbackSettings.trueSpeed
    },
    ...PLAYBACK_SPEED_OPTIONS.map((rate, index) => ({
      id: `setPlaybackRate:${rate}`,
      label: deps.translate('main.menu.speedPreset', { default: '{rate}×', values: { rate: String(rate) } }),
      icon: 'speed',
      checked: deps.playbackSettings.playbackRate === rate,
      separatorBefore: index === 0
    }))
  ] satisfies MenuActionItem[];
}

function buildRafMenuItems(deps: MenuItemsDeps): MenuActionItem[] {
  return [
    {
      id: 'toggleRaf',
      label: deps.rafSettings.enabled
        ? deps.translate('main.player.bypassRaf', { default: 'Bypass Raf' })
        : deps.translate('main.menu.enableRaf', { default: 'Enable Raf' }),
      icon: 'power_settings_new'
    },
    {
      id: 'openRaf',
      label: deps.translate('main.player.openRaf', { default: 'Open Raf' }),
      icon: 'tune'
    },
    ...(deps.rafPresets.presets.length > 0
      ? deps.rafPresets.presets.map((preset, index) => ({
          id: `applyRafPreset:${preset.id}`,
          label: `${preset.name}${preset.id === deps.rafPresets.selectedPresetId && isRafPresetDirty(deps.rafPresets, deps.rafSettings) ? ' *' : ''}`,
          icon: 'tune',
          checked: preset.id === deps.rafPresets.selectedPresetId,
          separatorBefore: index === 0
        }) satisfies MenuActionItem)
      : [{
          id: 'rafNoPresets',
          label: deps.translate('main.player.noRafPresets', { default: 'No Raf presets' }),
          icon: 'tune',
          disabled: true,
          separatorBefore: true
        } satisfies MenuActionItem])
  ] satisfies MenuActionItem[];
}

function buildBookmarksMenuItems(playingTrack: TrackItem | null, translate: MenuTranslation): MenuActionItem[] {
  const bookmarks: PlaybackBookmark[] = playingTrack ? getPlaybackBookmarks(playingTrack) : [];

  return [
    ...bookmarks.map((bookmark): MenuActionItem => ({
      id: `bookmark:seek:${bookmark.id}`,
      label: bookmark.name,
      shortcut: formatDuration(bookmark.time),
      icon: 'bookmark',
      removeActionId: `bookmark:delete:${bookmark.id}`,
      removeLabel: translate('main.player.deleteBookmark', {
        default: 'Delete bookmark {name}',
        values: { name: bookmark.name }
      })
    })),
    {
      id: 'bookmark:add',
      label: translate('main.player.addBookmark', { default: 'Add bookmark' }),
      icon: 'bookmark_add',
      separatorBefore: bookmarks.length > 0
    }
  ] satisfies MenuActionItem[];
}

function buildSleepTimerMenuItems(deps: MenuItemsDeps): MenuActionItem[] {
  return [
    {
      id: 'sleepTimerOff',
      label: deps.translate('main.menu.sleepTimerOff', { default: 'Off' }),
      icon: 'timer_off',
      checked: !deps.sleepTimer.active
    },
    ...SLEEP_TIMER_PRESET_MINUTES.map((minutes, index) => ({
      id: `sleepTimerSet:${minutes}`,
      label: deps.translate('main.menu.sleepTimerMinutes', { default: '{minutes} min', values: { minutes: String(minutes) } }),
      icon: 'timer',
      checked: deps.sleepTimer.active && deps.sleepTimer.durationMinutes === minutes,
      separatorBefore: index === 0
    }))
  ] satisfies MenuActionItem[];
}

function buildPlaybackMenuItems(
  deps: MenuItemsDeps,
  rafMenuItems: MenuActionItem[],
  bookmarksMenuItems: MenuActionItem[],
  sleepTimerMenuItems: MenuActionItem[],
  playbackSpeedMenuItems: MenuActionItem[]
): MenuActionItem[] {
  return [
    {
      id: 'sleepTimer',
      label: deps.translate('main.menu.sleepTimer', { default: 'Sleep timer' }),
      description: deps.sleepTimer.active && deps.sleepTimer.remainingSeconds !== null
        ? deps.translate('main.menu.sleepTimerRemaining', {
            default: 'Stops in {time}',
            values: { time: formatDuration(deps.sleepTimer.remainingSeconds) }
          })
        : undefined,
      icon: 'bedtime',
      children: sleepTimerMenuItems
    },
    {
      id: 'toggleStopAfterTrack',
      label: deps.translate('main.menu.stopAfterTrack', { default: 'Stop after current track' }),
      icon: 'stop',
      checked: deps.playbackSettings.stopAfterTrack
    },
    {
      id: 'playbackSpeed',
      label: deps.translate('options.playback.playbackRate.title', { default: 'Playback speed' }),
      icon: 'speed',
      separatorBefore: true,
      children: playbackSpeedMenuItems
    },
    {
      id: 'bookmarks',
      label: deps.translate('main.player.bookmarks', { default: 'Bookmarks' }),
      icon: 'bookmarks',
      disabled: !deps.playingTrack,
      children: bookmarksMenuItems
    },
    {
      id: deps.abLoop.start === null
        ? 'abLoopSetStart'
        : deps.abLoop.end === null
          ? 'abLoopSetEnd'
          : 'abLoopClear',
      label: deps.abLoop.start === null
        ? deps.translate('main.menu.abLoopSetStart', { default: 'Set A-B start' })
        : deps.abLoop.end === null
          ? deps.translate('main.menu.abLoopSetEnd', { default: 'Set A-B end' })
          : deps.translate('main.menu.abLoopStop', { default: 'Stop A-B loop' }),
      description: deps.abLoop.active && deps.abLoop.start !== null && deps.abLoop.end !== null
        ? deps.translate('main.menu.abLoopActive', {
            default: 'Looping {start}–{end}',
            values: { start: formatDuration(deps.abLoop.start), end: formatDuration(deps.abLoop.end) }
          })
        : undefined,
      icon: deps.abLoop.end === null ? 'flag' : 'repeat',
      checked: deps.abLoop.active,
      disabled: !deps.playingTrack
    },
    {
      id: 'raf',
      label: deps.translate('options.views.raf', { default: 'Raf' }),
      icon: 'tune',
      children: rafMenuItems
    }
  ] satisfies MenuActionItem[];
}

function buildAppMenuItems(deps: MenuItemsDeps, multiplayerMenuItems: MenuActionItem[], loadoutMenuItems: MenuActionItem[]): MenuActionItem[] {
  return [
    ...(deps.installAvailable
      ? [{
          id: 'installApp',
          label: deps.translate('main.menu.installApp', { default: 'Install izci...' }),
          description: deps.showInstallHint || deps.installHintPresentedInOpenMenu
            ? deps.translate('main.menu.installDescription', {
                default: 'Install the PWA to get file associations, a compact title bar, better OS integration and automatic updates.'
              })
            : undefined,
          icon: 'install_desktop',
          attention: deps.showInstallHint || deps.installHintPresentedInOpenMenu
        } satisfies MenuActionItem]
      : []),
    {
      id: 'openOptions',
      label: deps.translate('main.menu.options', { default: 'Options...' }),
      icon: 'settings',
      shortcut: 'Ctrl+P',
      separatorBefore: deps.installAvailable
    },
    {
      id: 'loadouts',
      label: deps.translate('main.menu.loadouts', { default: 'Loadouts' }),
      icon: 'bookmarks',
      children: loadoutMenuItems
    },
    ...(deps.multiplayerEnabled
      ? [{
          id: 'multiplayer',
          label: deps.translate('main.multiplayer.label', { default: 'Multiplayer' }),
          icon: 'cast',
          children: multiplayerMenuItems
        } satisfies MenuActionItem]
      : []),
    {
      id: 'openTroubadour',
      label: deps.translate('main.menu.troubadour', { default: 'Troubadour...' }),
      icon: 'library_music',
      separatorBefore: true
    },
    {
      id: 'openAudioCompare',
      label: deps.translate('main.menu.audioCompare', { default: 'Audio Compare...' }),
      icon: 'compare_arrows'
    },
    {
      id: 'openEditor',
      label: deps.translate('main.menu.editor', { default: 'Editor...' }),
      icon: 'content_cut'
    },
    {
      id: 'openConverter',
      label: deps.translate('main.menu.converter', { default: 'Converter...' }),
      icon: 'sync_alt'
    },
    {
      id: 'exit',
      label: deps.translate('main.menu.exit', { default: 'Exit' }),
      icon: 'logout',
      shortcut: 'Ctrl+Q',
      separatorBefore: true
    }
  ] satisfies MenuActionItem[];
}

function buildFileMenuItems(deps: MenuItemsDeps): MenuActionItem[] {
  return [
    {
      id: 'openFiles',
      label: deps.translate('main.menu.openFiles', { default: 'Open files...' }),
      icon: 'file_open',
      shortcut: 'Ctrl+O'
    },
    {
      id: 'openFolder',
      label: deps.translate('main.menu.openFolder', { default: 'Open folder...' }),
      icon: 'folder_open'
    },
    {
      id: 'manageFolders',
      label: deps.translate('main.menu.manageFolders', { default: 'Manage folders...' }),
      icon: 'folder_copy',
      separatorBefore: true
    }
  ] satisfies MenuActionItem[];
}

function buildViewMenuItems(deps: MenuItemsDeps): MenuActionItem[] {
  return [
    {
      id: 'showQueue',
      label: deps.translate('main.menu.queue', { default: 'Queue' }),
      icon: 'queue_music'
    },
    {
      id: 'showLibrary',
      label: deps.translate('main.menu.library', { default: 'Library' }),
      icon: 'library_music'
    },
    {
      id: 'showTrackDetails',
      label: deps.translate('main.menu.trackDetails', { default: 'Track Details' }),
      icon: 'info'
    },
    {
      id: 'showLyrics',
      label: deps.translate('main.menu.lyrics', { default: 'Lyrics' }),
      icon: 'lyrics'
    },
    {
      id: 'togglePatterns',
      label: deps.translate('main.menu.patterns', { default: 'Patterns' }),
      icon: 'view_timeline'
    },
    ...(deps.miniPlayerSupported
      ? [{
          id: 'toggleMiniPlayer',
          label: deps.translate('main.menu.miniPlayer', { default: 'Mini player' }),
          icon: 'picture_in_picture_alt',
          checked: deps.miniPlayerActive,
          shortcut: 'Ctrl+M',
          separatorBefore: true
        } satisfies MenuActionItem]
      : []),
    {
      id: 'toggleNowPlayingView',
      label: deps.translate('main.menu.nowPlaying', { default: 'Now Playing' }),
      icon: 'album',
      checked: deps.nowPlayingViewActive
    }
  ] satisfies MenuActionItem[];
}

function buildVideoMenuItems(deps: MenuItemsDeps): MenuActionItem[] {
  return [
    {
      id: 'videoFitContain',
      label: deps.translate('main.video.fit', { default: 'Fit to window' }),
      icon: 'fit_screen',
      checked: deps.videoFitMode === 'contain'
    },
    {
      id: 'videoFitCover',
      label: deps.translate('main.video.fill', { default: 'Fill window' }),
      icon: 'crop_free',
      checked: deps.videoFitMode === 'cover'
    },
    ...(deps.videoPictureInPictureSupported
      ? [{
          id: 'toggleVideoPictureInPicture',
          label: deps.translate('main.video.pictureInPicture', { default: 'Picture in Picture' }),
          icon: 'picture_in_picture_alt',
          separatorBefore: true
        } satisfies MenuActionItem]
      : []),
    {
      id: 'toggleVideoTheater',
      label: deps.videoTheaterActive
        ? deps.translate('main.player.exitVideoTheater', { default: 'Exit video theater' })
        : deps.translate('main.player.enterVideoTheater', { default: 'Enter video theater' }),
      icon: 'fit_screen',
      checked: deps.videoTheaterActive,
      separatorBefore: !deps.videoPictureInPictureSupported
    }
  ] satisfies MenuActionItem[];
}

function buildHelpMenuItems(deps: MenuItemsDeps): MenuActionItem[] {
  return [
    {
      id: 'openLogs',
      label: deps.translate('main.menu.logs', { default: 'Logs...' }),
      icon: 'article'
    },
    {
      id: 'forceUpdate',
      label: deps.translate('main.menu.forceUpdate', { default: 'Force update' }),
      icon: 'sync'
    },
    {
      id: 'openAbout',
      label: deps.translate('main.menu.about', { default: 'About' }),
      icon: 'info',
      separatorBefore: true
    }
  ] satisfies MenuActionItem[];
}

function buildMenuGroups(
  deps: MenuItemsDeps,
  appMenuItems: MenuActionItem[],
  fileMenuItems: MenuActionItem[],
  viewMenuItems: MenuActionItem[],
  playbackMenuItems: MenuActionItem[],
  videoMenuItems: MenuActionItem[],
  helpMenuItems: MenuActionItem[],
  sessionMenuItems: MenuActionItem[]
): WindowMenuGroup[] {
  return [
    {
      id: 'app',
      label: deps.translate('main.menu.applicationMenu', { default: 'Application menu' }),
      items: appMenuItems,
      application: true,
      attention: deps.showInstallHint
    },
    ...(deps.multiplayerMode === 'client'
      ? [{
          id: 'session',
          label: deps.translate('main.multiplayer.session', { default: 'Session' }),
          icon: 'cast_connected',
          items: sessionMenuItems
        } satisfies WindowMenuGroup]
      : [{
          id: 'file',
          label: deps.translate('main.menu.file', { default: 'File' }),
          icon: 'folder',
          items: fileMenuItems
        } satisfies WindowMenuGroup]
    ),
    {
      id: 'view',
      label: deps.translate('main.menu.view', { default: 'View' }),
      icon: 'visibility',
      items: viewMenuItems
    },
    {
      id: 'playback',
      label: deps.translate('options.views.playback', { default: 'Playback' }),
      icon: 'play_circle',
      items: playbackMenuItems
    },
    ...(deps.videoActive
      ? [{
          id: 'video',
          label: deps.translate('main.video.menu', { default: 'Video' }),
          icon: 'movie',
          items: videoMenuItems
        } satisfies WindowMenuGroup]
      : []),
    {
      id: 'help',
      label: deps.translate('main.menu.help', { default: 'Help' }),
      icon: 'help',
      items: helpMenuItems
    }
  ] satisfies WindowMenuGroup[];
}
