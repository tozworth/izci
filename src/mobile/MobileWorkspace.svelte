<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import BackdropZone from '$lib/components/BackdropZone.svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import WorkspaceTabContent from '$lib/components/workspace/WorkspaceTabContent.svelte';
  import type { ArtworkPresentationState } from '$lib/services/artwork-presentation';
  import type { WorkspaceShellState } from '$lib/services/workspace-shell';
  import { hasArtworkBackdrop, hasVisualizerBackdrop } from '$lib/stores/appearance-settings';
  import type {
    AppearanceSettings,
    BackdropZoneArtworkSettingsMap,
    BackdropZoneEffect,
    LyricsDisplayStyle,
    ModulePatternSnapshot,
    PlaybackSnapshot,
    PlaylistItem,
    VideoFitMode,
    WorkspacePanelId,
    WorkspaceTab
  } from '$lib/types';
  import type { Readable } from 'svelte/store';
  import type { TrackLibraryNavigationTargets, TrackLibraryNavigationTarget } from '$lib/services/library-navigation';
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
  import type { VideoSeekFeedback, QueuePanelHandlers, QueuePanelProps, WorkspacePanelHandlers, WorkspaceTabContentProps } from '$lib/components/workspace/types';
  import MobileMenuDrawer from './MobileMenuDrawer.svelte';
  import MobileMultiplayerStats from './MobileMultiplayerStats.svelte';
  import { resolveHorizontalSwipe, shouldIgnoreSwipeTarget, type SwipePoint } from './tab-swipe';
  import {
    getMobileDestination,
    MOBILE_DESTINATIONS,
    resolveMobileSwipeDestination,
    type MobileDestination
  } from './mobile-navigation';

  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let playbackSnapshot: PlaybackSnapshot;
  export let nowPlayingActive = false;
  export let videoElement: HTMLVideoElement | null;
  export let videoParkingHost: HTMLDivElement | null;
  export let videoTheaterActive = false;
  export let videoFitMode: VideoFitMode = 'contain';
  export let videoPictureInPictureSupported = false;
  export let videoSeekFeedback: VideoSeekFeedback | null = null;
  export let inactive = false;
  export let workspaceState: WorkspaceShellState;
  export let playlistPanelHandlers: WorkspacePanelHandlers;
  export let libraryPanelHandlers: WorkspacePanelHandlers;
  export let queuePanelProps: QueuePanelProps;
  export let queuePanelHandlers: QueuePanelHandlers;
  export let selectedPlaylistItem: PlaylistItem | null;
  export let playerDisplayTrack: PlaylistItem | null;
  export let lyricsTrack: PlaylistItem | null;
  export let modulePatternSnapshot: ModulePatternSnapshot;
  export let artworkState: ArtworkPresentationState;
  export let detailsLibraryTargets: TrackLibraryNavigationTargets = {};
  export let onNavigateTrackDetailsToLibrary: (target: TrackLibraryNavigationTarget) => void = () => {};
  export let appearance: AppearanceSettings;
  export let zoneEffects: Record<WorkspacePanelId, BackdropZoneEffect>;
  export let zoneArtworkSettings: Pick<BackdropZoneArtworkSettingsMap, WorkspacePanelId>;
  export let zoneArtworkBright: Record<WorkspacePanelId, boolean>;
  export let nowPlayingArtworkBright = false;
  export let effectiveLyricsDisplayStyle: LyricsDisplayStyle;
  export let lyricsAutoScroll: boolean;
  export let lyricsFontSize: number;
  export let lyricsResumeAutoScrollToken: number;
  export let installAvailable = false;
  export let videoAvailable = false;
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
  export let multiplayerFreeplayPaired = false;
  export let multiplayerFreeplay = false;
  export let multiplayerReceiveAudio = true;
  export let multiplayerConnectionStats: MultiplayerConnectionStats | null = null;
  export let multiplayerClients: MultiplayerClient[] = [];
  export let multiplayerRecents: MultiplayerRecent[] = [];
  export let multiplayerPairings: MultiplayerPairing[] = [];

  const dispatch = createEventDispatcher<{
    tabChange: WorkspaceTab;
    toggleNowPlaying: void;
    closeNowPlaying: void;
    openFiles: void;
    openFolder: void;
    manageFolders: void;
    openOptions: void;
    openAbout: void;
    install: void;
    multiplayerHost: void;
    multiplayerStopHosting: void;
    multiplayerJoin: void;
    multiplayerJoinRecent: string;
    multiplayerJoinPaired: string;
    multiplayerForgetPairing: string;
    multiplayerLeave: void;
    multiplayerCopyInvite: void;
    multiplayerResumeAudio: void;
    multiplayerKick: string;
    multiplayerTogglePair: string;
    togglePatterns: void;
    toggle: void;
    previous: void;
    next: void;
    previousSubsong: void;
    nextSubsong: void;
    seek: number;
    volume: number;
    mute: void;
    showTrack: string;
    toggleVideoTheater: void;
    togglePictureInPicture: void;
    setVideoFit: VideoFitMode;
  }>();

  let menuOpen = false;
  let multiplayerStatsOpen = false;
  let swipeStart: SwipePoint | null = null;
  let swipeCurrent: SwipePoint | null = null;
  let swipeLocked = false;
  let transitionDirection: -1 | 1 = 1;

  $: activeTab = workspaceState.activeWorkspaceTab;
  $: activeDefinition = workspaceState.workspaceTabs.find((tab) => tab.id === activeTab);
  $: activePanel = workspaceState.workspacePanels.find((panel) => panel.tabs.some((tab) => tab.id === activeTab));
  $: backdropPanelId = activePanel?.backdropPanelId ?? 'center';
  $: effect = zoneEffects[backdropPanelId];
  $: artworkBright = zoneArtworkBright[backdropPanelId];
  $: content = {
    snapshotStore,
    playbackSnapshot,
    playlistPanelProps: {
      ...workspaceState.playlistPanelProps,
      mobilePresentation: true
    },
    playlistPanelHandlers,
    libraryPanelProps: {
      ...workspaceState.libraryPanelProps,
      mobilePresentation: true
    },
    libraryPanelHandlers,
    queuePanelProps,
    queuePanelHandlers,
    selectedItem: artworkState.detailsDisplayTrack,
    lyricsTrack,
    patternTrack: playerDisplayTrack,
    modulePatternSnapshot,
    detailsArtwork: artworkState.visibleDetailsArtwork,
    detailsLibraryTargets,
    navigateTrackDetailsToLibrary: onNavigateTrackDetailsToLibrary,
    lyricsDisplayStyle: effectiveLyricsDisplayStyle,
    lyricsAutoScroll,
    lyricsFontSize,
    lyricsResumeAutoScrollToken,
    videoElement,
    videoParkingHost,
    videoTheaterActive,
    videoFitMode,
    videoPictureInPictureSupported,
    videoSeekFeedback,
    lyricsTheaterDowntimeDots: appearance.lyrics.theaterDowntimeDots,
    lyricsTheaterDowntimeThresholdSeconds: appearance.lyrics.theaterDowntimeThresholdSeconds,
    lyricsTheaterSmoothScroll: appearance.lyrics.theaterSmoothScroll
  } satisfies WorkspaceTabContentProps;

  function beginSwipe(event: TouchEvent): void {
    const touch = event.touches[0];
    swipeLocked = shouldIgnoreSwipeTarget(event.target);
    swipeStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
    swipeCurrent = swipeStart;
  }

  function trackSwipe(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch || !swipeStart || swipeLocked) return;

    swipeCurrent = { x: touch.clientX, y: touch.clientY };
    if (resolveHorizontalSwipe(swipeStart, swipeCurrent, 18) !== null) {
      event.preventDefault();
    }
  }

  function resetSwipe(): void {
    swipeStart = null;
    swipeCurrent = null;
    swipeLocked = false;
  }

  function getActiveDestination(): MobileDestination {
    return getMobileDestination(activeTab, nowPlayingActive);
  }

  function navigateToDestination(destination: MobileDestination): void {
    const currentDestination = getActiveDestination();
    if (destination === currentDestination) return;

    transitionDirection = MOBILE_DESTINATIONS.indexOf(destination) > MOBILE_DESTINATIONS.indexOf(currentDestination)
      ? 1
      : -1;

    if (destination === 'now-playing') {
      dispatch('toggleNowPlaying');
      return;
    }

    if (nowPlayingActive) dispatch('closeNowPlaying');
    dispatch('tabChange', destination);
  }

  function endSwipe(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    if (!touch || !swipeStart || swipeLocked) {
      resetSwipe();
      return;
    }

    const direction = resolveHorizontalSwipe(swipeStart, { x: touch.clientX, y: touch.clientY });
    if (direction !== null) {
      const nextDestination = resolveMobileSwipeDestination(getActiveDestination(), direction);
      if (nextDestination) navigateToDestination(nextDestination);
    }

    resetSwipe();
  }

  function selectTab(tab: WorkspaceTab): void {
    if (nowPlayingActive) dispatch('closeNowPlaying');
    dispatch('tabChange', tab);
  }
</script>

<main class="mobile-workspace" inert={inactive ? true : undefined}>
  <header class="mobile-app-header">
    <button class="mobile-header-button" type="button" aria-label={$t('mobile.menu.open', { default: 'Open menu' })} on:click={() => (menuOpen = true)}>
      <span class="material-symbols-outlined" aria-hidden="true">menu</span>
    </button>
    <div class="mobile-header-title">
      <span>{nowPlayingActive ? $t('main.menu.nowPlaying', { default: 'Now Playing' }) : activeDefinition?.label ?? 'izci'}</span>
      {#if !nowPlayingActive && activeTab !== 'playlist' && activeTab !== 'library'}
        <small>izci</small>
      {/if}
    </div>
    {#if !nowPlayingActive && (activeTab === 'playlist' || activeTab === 'library')}
      <button class="mobile-header-button" type="button" aria-label={$t('playlist.addFiles', { default: 'Add files' })} on:click={() => dispatch('openFiles')}>
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
      </button>
    {:else}
      <span class="mobile-header-spacer" aria-hidden="true"></span>
    {/if}
  </header>

  <div
    class="mobile-tab-viewport"
    role="region"
    aria-label={$t('mobile.navigation.swipeRegion', { default: 'Swipe between views' })}
    on:touchstart={beginSwipe}
    on:touchmove|nonpassive={trackSwipe}
    on:touchend={endSwipe}
    on:touchcancel={resetSwipe}
  >
    {#key nowPlayingActive ? 'now-playing' : activeTab}
      <div
        class="mobile-swipe-page"
        class:swipe-forward={transitionDirection === 1}
        class:swipe-backward={transitionDirection === -1}
      >
        {#if nowPlayingActive}
          <BackdropZone
            className="mobile-now-playing"
            effect={appearance.backdropZones.nowPlaying}
            artwork={artworkState.visibleArtworkBackground}
            artworkSettings={appearance.backdropZoneArtwork.nowPlaying}
            artworkBright={nowPlayingArtworkBright}
            fillParent={true}
            zoneId="nowPlaying"
          >
            <div class="mobile-now-playing-content">
              <div class="mobile-now-playing-artwork" aria-hidden="true">
                {#if artworkState.displayedArtwork}
                  <img src={artworkState.displayedArtwork.url} alt="" />
                {:else}
                  <span class="mobile-artwork-placeholder"></span>
                {/if}
              </div>
              <PlayerControls
                presentation="now-playing"
                {snapshotStore}
                track={playerDisplayTrack}
                selectedTrack={selectedPlaylistItem}
                artwork={artworkState.displayedArtwork}
                useArtworkColorsOverride={appearance.useNowPlayingArtworkPlayerColors}
                on:toggle={() => dispatch('toggle')}
                on:previous={() => dispatch('previous')}
                on:next={() => dispatch('next')}
                on:previousSubsong={() => dispatch('previousSubsong')}
                on:nextSubsong={() => dispatch('nextSubsong')}
                on:seek={(event) => dispatch('seek', event.detail)}
                on:volume={(event) => dispatch('volume', event.detail)}
                on:mute={() => dispatch('mute')}
                on:showTrack={(event) => dispatch('showTrack', event.detail)}
              />
              {#if multiplayerMode !== 'idle' && multiplayerHostName}
                <button
                  type="button"
                  class="mobile-multiplayer-pill"
                  class:is-disconnected={multiplayerConnectionStatus === 'disconnected' || multiplayerConnectionStatus === 'error'}
                  class:is-reconnecting={multiplayerReconnecting}
                  class:is-relayed={multiplayerConnectionStatus === 'connected' && multiplayerConnectionRoute === 'relayed'}
                  title={multiplayerFreeplay
                    ? $t('main.multiplayer.freeplay.label', { default: 'Freeplay' })
                    : $t('main.multiplayer.label', { default: 'Multiplayer' })}
                  aria-label={$t('main.multiplayer.stats.hostVersion', { default: 'Host izci' })}
                  on:click={() => (multiplayerStatsOpen = true)}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">{multiplayerFreeplay ? 'queue_music' : 'cast_connected'}</span>
                  <span>{multiplayerHostName}</span>
                </button>
              {/if}
            </div>
          </BackdropZone>
        {:else}
          <BackdropZone
            {effect}
            artwork={artworkState.visibleArtworkBackground}
            artworkSettings={zoneArtworkSettings[backdropPanelId]}
            artworkBright={artworkBright}
            fillParent={true}
            zoneId={backdropPanelId}
          >
            <div class="mobile-tab-page" role="tabpanel">
              <WorkspaceTabContent
                tab={activeTab}
                {content}
                artworkBackgroundActive={hasArtworkBackdrop(effect) && Boolean(artworkState.visibleArtworkBackground)}
                artworkBackgroundBright={artworkBright}
                visualizerBackdropActive={hasVisualizerBackdrop(effect)}
                isCompactWorkspace={true}
                on:seek={(event) => dispatch('seek', event.detail)}
                on:toggleVideoTheater={() => dispatch('toggleVideoTheater')}
                on:togglePictureInPicture={() => dispatch('togglePictureInPicture')}
                on:setVideoFit={(event) => dispatch('setVideoFit', event.detail)}
              />
            </div>
          </BackdropZone>
        {/if}
      </div>
    {/key}
  </div>

  <nav class="mobile-bottom-nav" aria-label={$t('mobile.navigation.label', { default: 'Primary navigation' })}>
    <button class:active={!nowPlayingActive && activeTab === 'playlist'} type="button" on:click={() => navigateToDestination('playlist')}>
      <span class="mobile-nav-icon"><span class="material-symbols-outlined" aria-hidden="true">queue_music</span></span>
      <span>{$t('main.menu.playlist', { default: 'Playlist' })}</span>
    </button>
    <button class:active={!nowPlayingActive && activeTab === 'library'} type="button" on:click={() => navigateToDestination('library')}>
      <span class="mobile-nav-icon"><span class="material-symbols-outlined" aria-hidden="true">library_music</span></span>
      <span>{$t('main.menu.library', { default: 'Library' })}</span>
    </button>
    <button class:active={nowPlayingActive} type="button" on:click={() => navigateToDestination('now-playing')}>
      <span class="mobile-nav-icon"><span class="material-symbols-outlined" aria-hidden="true">album</span></span>
      <span>{$t('main.menu.nowPlaying', { default: 'Now Playing' })}</span>
    </button>
    <button class:active={!nowPlayingActive && activeTab === 'lyrics'} type="button" on:click={() => navigateToDestination('lyrics')}>
      <span class="mobile-nav-icon"><span class="material-symbols-outlined" aria-hidden="true">lyrics</span></span>
      <span>{$t('main.menu.lyrics', { default: 'Lyrics' })}</span>
    </button>
    <button class:active={!nowPlayingActive && activeTab === 'details'} type="button" on:click={() => navigateToDestination('details')}>
      <span class="mobile-nav-icon"><span class="material-symbols-outlined" aria-hidden="true">info</span></span>
      <span>{$t('main.menu.trackDetails', { default: 'Details' })}</span>
    </button>
  </nav>
</main>

<MobileMenuDrawer
  open={menuOpen}
  {installAvailable}
  videoAvailable={videoAvailable}
  patternsVisible={workspaceState.isPatternsPanelVisible}
  {multiplayerEnabled}
  {multiplayerMode}
  {multiplayerConnectionStatus}
  {multiplayerReconnecting}
  {multiplayerAudioStatus}
  {multiplayerConnectionRoute}
  {multiplayerAudioBitrateKbps}
  {multiplayerInviteCode}
  {multiplayerHostName}
  {multiplayerFreeplayPaired}
  {multiplayerFreeplay}
  {multiplayerClients}
  {multiplayerRecents}
  {multiplayerPairings}
  on:close={() => (menuOpen = false)}
  on:openFiles={() => dispatch('openFiles')}
  on:openFolder={() => dispatch('openFolder')}
  on:manageFolders={() => dispatch('manageFolders')}
  on:showPatterns={() => dispatch('togglePatterns')}
  on:showVideo={() => selectTab('video')}
  on:openOptions={() => dispatch('openOptions')}
  on:openAbout={() => dispatch('openAbout')}
  on:install={() => dispatch('install')}
  on:multiplayerHost={() => dispatch('multiplayerHost')}
  on:multiplayerStopHosting={() => dispatch('multiplayerStopHosting')}
  on:multiplayerJoin={() => dispatch('multiplayerJoin')}
  on:multiplayerJoinRecent={(event) => dispatch('multiplayerJoinRecent', event.detail)}
  on:multiplayerJoinPaired={(event) => dispatch('multiplayerJoinPaired', event.detail)}
  on:multiplayerForgetPairing={(event) => dispatch('multiplayerForgetPairing', event.detail)}
  on:multiplayerLeave={() => dispatch('multiplayerLeave')}
  on:multiplayerCopyInvite={() => dispatch('multiplayerCopyInvite')}
  on:multiplayerResumeAudio={() => dispatch('multiplayerResumeAudio')}
  on:multiplayerKick={(event) => dispatch('multiplayerKick', event.detail)}
  on:multiplayerTogglePair={(event) => dispatch('multiplayerTogglePair', event.detail)}
/>

{#if multiplayerStatsOpen}
  <MobileMultiplayerStats
    hostName={multiplayerHostName}
    hostVersion={multiplayerHostVersion}
    connectionStatus={multiplayerConnectionStatus}
    connectionRoute={multiplayerConnectionRoute}
    audioBitrateKbps={multiplayerAudioBitrateKbps}
    receiveAudio={multiplayerReceiveAudio}
    freeplay={multiplayerFreeplay}
    connectionStats={multiplayerConnectionStats}
    on:close={() => (multiplayerStatsOpen = false)}
  />
{/if}
