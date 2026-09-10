<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import { pwaUpdateStatus } from '$lib/services/pwa-updates';
  import { loadouts } from '$lib/stores/loadouts';
  import { playbackSettings } from '$lib/stores/playback-settings';
  import { rafPresets } from '$lib/stores/raf-presets';
  import { rafSettings } from '$lib/stores/raf-settings';
  import { sleepTimer } from '$lib/services/sleep-timer';
  import { abLoop } from '$lib/services/ab-loop';
  import {
    getPlaybackBookmarkFileKey,
    getPlaybackBookmarks,
    type PlaybackBookmark
  } from '$lib/services/playback-bookmarks';
  import { createMenuActions, type MenuActionId } from '$lib/services/menu-actions';
  import { buildMenuItems } from '$lib/services/menu-items';
  import type { MediaTabKind, TrackItem, VideoFitMode, WindowMenuSubtitleTone, WorkspaceTab } from '$lib/types';
  import type {
    MultiplayerClient,
    MultiplayerAudioStatus,
    MultiplayerConnectionStats,
    MultiplayerConnectionStatus,
    MultiplayerMode
  } from '$lib/services/multiplayer-types';
  import type { MultiplayerConnectionRoute } from '$lib/services/multiplayer-ice';
  import type { MultiplayerRecent } from '$lib/stores/multiplayer-recents';
  import type { MultiplayerPairing } from '$lib/stores/multiplayer-pairings';
  import type { OptionsViewName } from '../../options/views';

  export let nowPlayingViewActive = false;
  export let miniPlayerSupported = false;
  export let miniPlayerActive = false;
  export let openWorkspaceTabs: WorkspaceTab[] = [];
  export let visualMediaActive = false;
  export let mediaTabKind: MediaTabKind = 'video';
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
    showChat: void;
    toggleMedia: void;
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

  const menuActions = createMenuActions({
    getPlayingTrack: () => playingTrack,
    getPlaybackTime: () => playbackTime,
    getMultiplayerReceiveAudio: () => multiplayerReceiveAudio,
    getBookmarks: () => bookmarks,
    setBookmarks: (next) => { bookmarks = next; },
    dispatch: (action, detail) => dispatch(action as never, detail as never)
  });

  $: bookmarkTrackKey = playingTrack ? getPlaybackBookmarkFileKey(playingTrack) : null;
  $: if (bookmarkTrackKey !== loadedBookmarkTrackKey) {
    loadedBookmarkTrackKey = bookmarkTrackKey;
    bookmarks = playingTrack ? getPlaybackBookmarks(playingTrack) : [];
  }

  $: menu = buildMenuItems({
    translate: get(t),
    multiplayerMode,
    multiplayerFreeplayEnabled,
    multiplayerPairings,
    multiplayerRecents,
    multiplayerInviteCode,
    multiplayerClients,
    multiplayerConnectionStatus,
    multiplayerHostName,
    multiplayerAudioStatus,
    multiplayerConnectionRoute,
    multiplayerAudioBitrateKbps,
    multiplayerFreeplay,
    multiplayerFreeplayPaired,
    multiplayerReceiveAudio,
    multiplayerHostVersion,
    multiplayerConnectionStats,
    multiplayerEnabled,
    playingTrack,
    installAvailable,
    showInstallHint,
    installHintPresentedInOpenMenu,
    miniPlayerSupported,
    miniPlayerActive,
    nowPlayingViewActive,
    openWorkspaceTabs,
    visualMediaActive,
    mediaTabKind,
    videoActive,
    videoFitMode,
    videoPictureInPictureSupported,
    videoTheaterActive,
    pwaUpdateStatus: $pwaUpdateStatus,
    playbackSettings: $playbackSettings,
    rafSettings: $rafSettings,
    abLoop: $abLoop,
    sleepTimer: $sleepTimer,
    loadouts: $loadouts,
    rafPresets: $rafPresets
  });

  $: menuGroups = menu.menuGroups;
  $: menuSubtitle = menu.menuSubtitle;
  $: menuSubtitleTone =
    $pwaUpdateStatus === 'updated'
      ? 'success'
      : $pwaUpdateStatus === 'up-to-date'
        ? 'current'
        : $pwaUpdateStatus === 'failed'
          ? 'warning'
          : 'muted';
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
  on:action={(event) => menuActions.runMenuAction(event.detail as MenuActionId)}
/>
