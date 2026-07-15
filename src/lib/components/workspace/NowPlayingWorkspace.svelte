<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import BackdropZone from '$lib/components/BackdropZone.svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import {
    hasArtworkBackdrop,
    NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS
  } from '$lib/stores/appearance-settings';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import type {
    BackdropZoneEffect,
    BackdropZoneArtworkSettings,
    PlaylistItem,
    WorkspaceTab
  } from '$lib/types';
  import WorkspaceTabBar from './WorkspaceTabBar.svelte';
  import WorkspaceTabContent from './WorkspaceTabContent.svelte';
  import type {
    WorkspaceTabContentProps,
    WorkspaceTabDefinition,
    WorkspaceTabMoveDetail
  } from './types';

  export let content: WorkspaceTabContentProps;
  export let track: PlaylistItem | null = null;
  export let selectedTrack: PlaylistItem | null = null;
  export let artwork: LoadedStreamArtwork | null = null;
  export let backdropArtwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundBright = false;
  export let backdropEffect: BackdropZoneEffect = 'none';
  export let backdropArtworkSettings: BackdropZoneArtworkSettings | null = null;
  export let activeWorkspaceTab: WorkspaceTab = 'playlist';
  export let workspaceTabs: WorkspaceTabDefinition[] = [];
  export let panelAutoHideDelaySeconds = 5;
  export let alwaysUseArtworkPlayerColors = false;

  const dispatch = createEventDispatcher<{
    close: void;
    chromeHiddenChange: boolean;
    seek: number;
    tabChange: WorkspaceTab;
    tabClose: WorkspaceTab;
    tabMove: WorkspaceTabMoveDetail;
  }>();

  let panelChromeHidden = false;
  let panelHideTimer: ReturnType<typeof window.setTimeout> | null = null;
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

<svelte:window on:pointermove={revealPanelChrome} />

<main
  class="workspace now-playing-workspace"
  class:is-cursor-hidden={panelChromeHidden}
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
      aria-label="Exit Now Playing"
      title="Exit Now Playing"
      on:click={() => dispatch('close')}
    >
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>

    <div class="now-playing-layout">
      <section class="now-playing-control-pane" aria-label="Now Playing">
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
          on:seek
          on:volume
          on:mute
          on:showTrack
        />
      </section>

      <section
        class="now-playing-queue-pane"
        aria-label="Workspace panels"
        on:focusin={revealPanelChrome}
      >
        <div
          class="now-playing-tabs-layout"
          class:is-chrome-hidden={panelChromeHidden}
        >
          <WorkspaceTabBar
            tabs={workspaceTabs}
            activeTab={activeWorkspaceTab}
            ariaLabel="Now Playing panels"
            className="now-playing-tabs"
            on:tabChange={(event) => dispatch('tabChange', event.detail)}
            on:tabClose={(event) => dispatch('tabClose', event.detail)}
            on:tabMove={(event) => dispatch('tabMove', event.detail)}
          />

          {#if workspaceTabs.length === 0}
            <div class="now-playing-tab-panel workspace-empty-surface" aria-label="Workspace is empty"></div>
          {:else}
            <div
              class="now-playing-tab-panel"
              role="tabpanel"
              id={`workspace-tab-panel-tabs-${activeWorkspaceTab}`}
              aria-labelledby={`workspace-tab-tabs-${activeWorkspaceTab}`}
            >
              <WorkspaceTabContent
                tab={activeWorkspaceTab}
                content={{ ...content, detailsArtwork: null }}
                on:seek
              />
            </div>
          {/if}
        </div>
      </section>
    </div>
  </BackdropZone>
</main>
