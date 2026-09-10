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
    MediaTabKind,
    VideoFitMode,
    WorkspacePanelId,
    WorkspaceTab
  } from '$lib/types';
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
  import type { WorkspaceTabContentProps } from '$lib/components/workspace/types';
  import MobileMenuDrawer from './MobileMenuDrawer.svelte';
  import MobileMultiplayerStats from './MobileMultiplayerStats.svelte';
  import { resolveHorizontalSwipe, shouldIgnoreSwipeTarget, type SwipePoint } from './tab-swipe';
  import {
    getMobileDestination,
    MOBILE_DESTINATIONS,
    resolveMobileSwipeDestination,
    type MobileDestination
  } from './mobile-navigation';

  export let content: WorkspaceTabContentProps;
  export let nowPlayingActive = false;
  export let workspaceState: WorkspaceShellState;
  export let selectedTrackItem: WorkspaceTabContentProps['selectedItem'];
  export let artworkState: ArtworkPresentationState;
  export let appearance: AppearanceSettings;
  export let zoneEffects: Record<WorkspacePanelId, BackdropZoneEffect>;
  export let zoneArtworkSettings: Pick<BackdropZoneArtworkSettingsMap, WorkspacePanelId>;
  export let zoneArtworkBright: Record<WorkspacePanelId, boolean>;
  export let nowPlayingArtworkBright = false;
  export let installAvailable = false;
  export let mediaAvailable = false;
  export let mediaKind: MediaTabKind = 'video';
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
    multiplayerHostWithCode: void;
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
    showChat: void;
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
  $: mobileContent = {
    ...content,
    queuePanelProps: {
      ...content.queuePanelProps,
      mobilePresentation: true
    },
    libraryPanelProps: {
      ...content.libraryPanelProps,
      mobilePresentation: true
    }
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
    if (
      (nowPlayingActive && destination === 'now-playing') ||
      (!nowPlayingActive && activeTab === destination)
    ) return;

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

  function showTrackDetails(id: string): void {
    if (nowPlayingActive) dispatch('closeNowPlaying');
    dispatch('showTrack', id);
  }
</script>

<main class="mobile-workspace" inert={content.videoTheaterActive ? true : undefined}>
  <header class="mobile-app-header">
    <button class="mobile-header-button" type="button" aria-label={$t('mobile.menu.open', { default: 'Open menu' })} on:click={() => (menuOpen = true)}>
      <span class="material-symbols-outlined" aria-hidden="true">menu</span>
    </button>
    <div class="mobile-header-title">
      <span>{nowPlayingActive ? $t('main.menu.nowPlaying', { default: 'Now Playing' }) : activeTab === 'media' ? (mediaKind === 'image' ? $t('workspace.tabs.image', { default: 'Image' }) : $t('workspace.tabs.video', { default: 'Video' })) : activeDefinition?.label ?? 'izci'}</span>
      {#if !nowPlayingActive && activeTab !== 'queue' && activeTab !== 'library'}
        <small>izci</small>
      {/if}
    </div>
    {#if !nowPlayingActive && (activeTab === 'queue' || activeTab === 'library')}
      <button class="mobile-header-button" type="button" aria-label={$t('queue.addFiles', { default: 'Add files' })} on:click={() => dispatch('openFiles')}>
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
                snapshotStore={content.snapshotStore}
                track={content.patternTrack}
                selectedTrack={selectedTrackItem}
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
                on:showTrack={(event) => showTrackDetails(event.detail)}
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
                content={mobileContent}
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
    <button class:active={!nowPlayingActive && activeTab === 'queue'} type="button" on:click={() => navigateToDestination('queue')}>
      <span class="mobile-nav-icon"><span class="material-symbols-outlined" aria-hidden="true">queue_music</span></span>
      <span>{$t('main.menu.queue', { default: 'Queue' })}</span>
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
  mediaAvailable={mediaAvailable}
  {mediaKind}
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
  on:showChat={() => selectTab('chat')}
  on:showMedia={() => selectTab('media')}
  on:openOptions={() => dispatch('openOptions')}
  on:openAbout={() => dispatch('openAbout')}
  on:install={() => dispatch('install')}
  on:multiplayerHost={() => dispatch('multiplayerHost')}
  on:multiplayerHostWithCode={() => dispatch('multiplayerHostWithCode')}
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
