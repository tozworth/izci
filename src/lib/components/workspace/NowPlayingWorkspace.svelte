<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import BackdropZone from '$lib/components/BackdropZone.svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import PlaylistPanel from '$lib/components/PlaylistPanel.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import type { BackdropZoneEffect, PlaybackSnapshot, PlaylistItem, WorkspaceTab } from '$lib/types';
  import type { Readable } from 'svelte/store';
  import type { WorkspacePanelHandlers, WorkspacePanelProps, WorkspaceTabDefinition } from './types';

  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let track: PlaylistItem | null = null;
  export let selectedTrack: PlaylistItem | null = null;
  export let artwork: LoadedStreamArtwork | null = null;
  export let backdropArtwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundBright = false;
  export let backdropEffect: BackdropZoneEffect = 'none';
  export let activeWorkspaceTab: WorkspaceTab = 'playlist';
  export let workspaceTabs: WorkspaceTabDefinition[] = [];
  export let playlistPanelProps: WorkspacePanelProps;
  export let playlistPanelHandlers: WorkspacePanelHandlers;
  export let libraryPanelProps: WorkspacePanelProps;
  export let libraryPanelHandlers: WorkspacePanelHandlers;
  export let selectedItem: PlaylistItem | null = null;

  const dispatch = createEventDispatcher<{
    close: void;
    tabChange: WorkspaceTab;
  }>();

  const REQUIRED_TABS: WorkspaceTabDefinition[] = [
    { id: 'playlist', icon: 'queue_music', label: 'Playlist' },
    { id: 'library', icon: 'library_music', label: 'Library' },
    { id: 'details', icon: 'info', label: 'Details' }
  ];

  function resolveQueueTabs(tabs: WorkspaceTabDefinition[]): WorkspaceTabDefinition[] {
    const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
    return REQUIRED_TABS.map((tab) => tabMap.get(tab.id) ?? tab);
  }

  $: queueTabs = resolveQueueTabs(workspaceTabs);
</script>

<main class="workspace now-playing-workspace">
  <BackdropZone
    effect={backdropEffect}
    artwork={backdropArtwork}
    artworkBright={artworkBackgroundBright}
    fillParent={true}
    className="now-playing-backdrop-zone"
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
          {snapshotStore}
          {track}
          {selectedTrack}
          {artwork}
          backdropEffect="none"
          {artworkBackgroundBright}
          on:toggle
          on:previous
          on:next
          on:seek
          on:volume
          on:mute
          on:showTrack
        />
      </section>

      <section class="now-playing-queue-pane" aria-label="Workspace panels">
        <div class="now-playing-tabs-layout">
          <div class="workspace-tabs now-playing-tabs" role="tablist" aria-label="Now Playing panels">
            {#each queueTabs as tab}
              <button
                type="button"
                class:active={activeWorkspaceTab === tab.id}
                class="workspace-tab"
                role="tab"
                aria-label={tab.label}
                aria-selected={activeWorkspaceTab === tab.id}
                aria-controls={`now-playing-tab-panel-${tab.id}`}
                id={`now-playing-tab-${tab.id}`}
                on:click={() => dispatch('tabChange', tab.id)}
              >
                <span class="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
                <span class="workspace-tab-label">{tab.label}</span>
              </button>
            {/each}
          </div>

          <div
            class="now-playing-tab-panel"
            role="tabpanel"
            id="now-playing-tab-panel-playlist"
            aria-labelledby="now-playing-tab-playlist"
            hidden={activeWorkspaceTab !== 'playlist'}
          >
            <PlaylistPanel
              {...playlistPanelProps}
              fillParent={true}
              hideEyebrow={true}
              on:addFiles={(event) => playlistPanelHandlers.addFiles(event.detail)}
              on:openFiles={playlistPanelHandlers.openFiles}
              on:select={playlistPanelHandlers.select}
              on:activate={playlistPanelHandlers.activate}
              on:contextAction={playlistPanelHandlers.contextAction}
              on:toggleShuffle={() => playlistPanelHandlers.toggleShuffle?.()}
              on:cycleRepeat={() => playlistPanelHandlers.cycleRepeat?.()}
            />
          </div>

          <div
            class="now-playing-tab-panel"
            role="tabpanel"
            id="now-playing-tab-panel-library"
            aria-labelledby="now-playing-tab-library"
            hidden={activeWorkspaceTab !== 'library'}
          >
            <PlaylistPanel
              {...libraryPanelProps}
              fillParent={true}
              hideEyebrow={true}
              on:addFiles={(event) => libraryPanelHandlers.addFiles(event.detail)}
              on:openFiles={libraryPanelHandlers.openFiles}
              on:select={libraryPanelHandlers.select}
              on:setSelection={(event) => libraryPanelHandlers.setSelection?.(event)}
              on:activate={libraryPanelHandlers.activate}
              on:contextAction={libraryPanelHandlers.contextAction}
            />
          </div>

          <div
            class="now-playing-tab-panel"
            role="tabpanel"
            id="now-playing-tab-panel-details"
            aria-labelledby="now-playing-tab-details"
            hidden={activeWorkspaceTab !== 'details'}
          >
            <TrackDetailsPanel
              track={selectedItem}
              artwork={null}
              fillParent={true}
              hideEyebrow={true}
            />
          </div>
        </div>
      </section>
    </div>
  </BackdropZone>
</main>
