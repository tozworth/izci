<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import BackdropZone from '$lib/components/BackdropZone.svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import {
    hasArtworkBackdrop,
    NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS
  } from '$lib/stores/appearance-settings';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import type { MultiplayerClient } from '$lib/services/multiplayer-types';
  import type {
    BackdropZoneEffect,
    BackdropZoneArtworkSettings,
    TrackItem,
    WorkspaceTab
  } from '$lib/types';
  import { nowPlayingState, moveNowPlayingTab, type FlyoutSide } from '$lib/stores/now-playing-state';
  import { createNowPlayingLyrics } from '$lib/services/now-playing-lyrics';
  import NowPlayingFlyout from './NowPlayingFlyout.svelte';
  import MultiplayerFloaters from './MultiplayerFloaters.svelte';
  import WorkspaceTabContent from './WorkspaceTabContent.svelte';
  import type {
    WorkspaceTabContentProps,
    WorkspaceTabDefinition,
    WorkspaceTabMoveDetail
  } from './types';

  export let content: WorkspaceTabContentProps;
  export let track: TrackItem | null = null;
  export let selectedTrack: TrackItem | null = null;
  export let artwork: LoadedStreamArtwork | null = null;
  export let backdropArtwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundBright = false;
  export let backdropEffect: BackdropZoneEffect = 'none';
  export let backdropArtworkSettings: BackdropZoneArtworkSettings | null = null;
  export let activeWorkspaceTab: WorkspaceTab = 'queue';
  export let workspaceTabs: WorkspaceTabDefinition[] = [];
  export let panelAutoHideDelaySeconds = 5;
  export let alwaysUseArtworkPlayerColors = false;
  export let multiplayerClients: MultiplayerClient[] = [];
  export let showMultiplayerFloaters = false;
  export let multiplayerFloaterSize = 100;
  export let multiplayerFloaterMotion = 35;

  const dispatch = createEventDispatcher<{
    close: void;
    chromeHiddenChange: boolean;
    seek: number;
    tabChange: WorkspaceTab;
    tabClose: WorkspaceTab;
    tabMove: WorkspaceTabMoveDetail;
  }>();

  const lyricsAvailable = createNowPlayingLyrics();
  onDestroy(() => lyricsAvailable.destroy());
  let contextualTab: 'lyrics' | 'patterns';
  let stageTab: 'lyrics' | 'patterns' | null;
  let openSide: FlyoutSide | null = null;
  let previousActiveTab = activeWorkspaceTab;
  $: lyricsAvailable.setTrack(content.lyricsTrack);
  $: contextualTab = track?.kind === 'module' ? 'patterns' : 'lyrics';
  $: contextualTabLabel = contextualTab === 'lyrics'
    ? $t('workspace.tabs.lyrics')
    : $t('workspace.tabs.patterns');
  $: stageTab = contextualTab === 'patterns'
    ? ($nowPlayingState.patterns ? 'patterns' : null)
    : ($nowPlayingState.lyrics && $lyricsAvailable ? 'lyrics' : null);
  $: flyoutTabs = workspaceTabs.filter(tab => tab.id !== 'lyrics' && tab.id !== 'patterns');
  $: leftTabs = flyoutTabs.filter(tab => $nowPlayingState.leftTabs.includes(tab.id));
  $: rightTabs = flyoutTabs.filter(tab => !$nowPlayingState.leftTabs.includes(tab.id));
  $: if (activeWorkspaceTab !== previousActiveTab) {
    previousActiveTab = activeWorkspaceTab;
    if (flyoutTabs.some(tab => tab.id === activeWorkspaceTab)) {
      openSide = $nowPlayingState.leftTabs.includes(activeWorkspaceTab) ? 'left' : 'right';
      revealPanelChrome();
    }
  }
  function toggleSide(side: FlyoutSide) { openSide = openSide === side ? null : side; revealPanelChrome(); }
  let panelChromeHidden = false;
  let panelHideTimer: number | null = null;
  let lastPanelAutoHideDelaySeconds = panelAutoHideDelaySeconds;

  function setPanelChromeHidden(hidden: boolean) {
    if (panelChromeHidden === hidden) {
      return;
    }

    panelChromeHidden = hidden;
    dispatch('chromeHiddenChange', hidden);
  }

  function isPanelAutoHideEnabled(delaySeconds: number): boolean {
    return delaySeconds < NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS;
  }

  function clearPanelHideTimer() {
    if (panelHideTimer === null) {
      return;
    }

    window.clearTimeout(panelHideTimer);
    panelHideTimer = null;
  }

  function schedulePanelHide() {
    clearPanelHideTimer();

    if (!isPanelAutoHideEnabled(panelAutoHideDelaySeconds)) {
      setPanelChromeHidden(false);
      return;
    }

    panelHideTimer = window.setTimeout(() => {
      if (document.querySelector('.now-playing-workspace :active')) {
        schedulePanelHide();
        return;
      }
      openSide = null;
      setPanelChromeHidden(true);
      panelHideTimer = null;
    }, panelAutoHideDelaySeconds * 1000);
  }

  function revealPanelChrome() {
    setPanelChromeHidden(false);
    schedulePanelHide();
  }

  onMount(() => {
    schedulePanelHide();

    return () => {
      clearPanelHideTimer();
    };
  });

  $: artworkColorSurfaceBright =
    hasArtworkBackdrop(backdropEffect) && Boolean(backdropArtwork) && artworkBackgroundBright;
  $: if (panelAutoHideDelaySeconds !== lastPanelAutoHideDelaySeconds) {
    lastPanelAutoHideDelaySeconds = panelAutoHideDelaySeconds;
    revealPanelChrome();
  }
</script>

<svelte:window on:pointermove={revealPanelChrome} on:pointerdown={revealPanelChrome} on:keydown={revealPanelChrome} />

<main
  class="workspace now-playing-workspace"
  class:is-cursor-hidden={panelChromeHidden}
  class:right-flyout-visible={(openSide === 'right') || ($nowPlayingState.rightPinned && rightTabs.length > 0)}
  style={`--np-left-width: min(${$nowPlayingState.leftWidth}px, 40vw); --np-right-width: min(${$nowPlayingState.rightWidth}px, 40vw);`}
>
  <BackdropZone
    effect={backdropEffect}
    artwork={backdropArtwork}
    artworkSettings={backdropArtworkSettings}
    artworkBright={artworkBackgroundBright}
    fillParent={true}
    className="now-playing-backdrop-zone"
    zoneId="nowPlaying"
  >
    <button
      type="button"
      class="now-playing-close"
      aria-label={$t('workspace.nowPlaying.exit', { default: 'Exit Now Playing' })}
      title={$t('workspace.nowPlaying.exit', { default: 'Exit Now Playing' })}
      on:click={() => dispatch('close')}
    >
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>

    {#if showMultiplayerFloaters}
      <MultiplayerFloaters
        clients={multiplayerClients}
        size={multiplayerFloaterSize}
        motion={multiplayerFloaterMotion}
      />
    {/if}

    <div class="now-playing-stage-shell" class:left-pinned={$nowPlayingState.leftPinned && leftTabs.length > 0} class:right-pinned={$nowPlayingState.rightPinned && rightTabs.length > 0}>
    <div class="now-playing-layout" class:has-context={stageTab !== null} class:has-patterns={stageTab === 'patterns'}>
      <section class="now-playing-control-pane" aria-label={$t('workspace.nowPlaying.title', { default: 'Now Playing' })}>
        <PlayerControls
          presentation="now-playing"
          snapshotStore={content.snapshotStore}
          {track}
          {selectedTrack}
          {artwork}
          backdropEffect="none"
          {artworkBackgroundBright}
          useArtworkColorsOverride={alwaysUseArtworkPlayerColors ? true : null}
          {artworkColorSurfaceBright}
          on:toggle
          on:previous
          on:next
          on:previousSubsong
          on:nextSubsong
          on:seek
          on:volume
          on:mute
          on:showTrack
        >
          <button slot="context-controls" type="button" class="transport-button now-playing-context-toggle"
            aria-label={contextualTabLabel} title={contextualTabLabel}
            aria-pressed={$nowPlayingState[contextualTab]}
            on:click={() => nowPlayingState.update({ [contextualTab]: !$nowPlayingState[contextualTab] })}>
            <span class="material-symbols-outlined" aria-hidden="true">{contextualTab === 'lyrics' ? 'lyrics' : 'grid_on'}</span>
          </button>
        </PlayerControls>
      </section>

      {#if stageTab}
        <section class="now-playing-context" aria-label={contextualTabLabel}>
          <WorkspaceTabContent tab={stageTab} {content} on:seek />
        </section>
      {/if}
    </div>
    </div>
    {#each ['left', 'right'] as side}
      <NowPlayingFlyout side={side === 'left' ? 'left' : 'right'}
        tabs={side === 'left' ? leftTabs : rightTabs} {activeWorkspaceTab} {content}
        pinned={side === 'left' ? $nowPlayingState.leftPinned : $nowPlayingState.rightPinned}
        open={openSide === side} chromeHidden={panelChromeHidden}
        on:toggle={() => toggleSide(side === 'left' ? 'left' : 'right')}
        on:pin={() => nowPlayingState.update(side === 'left' ? { leftPinned: !$nowPlayingState.leftPinned } : { rightPinned: !$nowPlayingState.rightPinned })}
        on:tabChange={(event) => dispatch('tabChange', event.detail)}
        on:tabClose={(event) => dispatch('tabClose', event.detail)}
        on:tabMove={(event) => { moveNowPlayingTab(event.detail.tabId, side === 'left' ? 'left' : 'right'); dispatch('tabMove', event.detail); }}
        on:move={(event) => { openSide = side === 'left' ? 'right' : 'left'; moveNowPlayingTab(event.detail, openSide); }}
        on:seek />
    {/each}
  </BackdropZone>
</main>
