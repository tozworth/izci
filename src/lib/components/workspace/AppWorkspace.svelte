<script lang="ts">
  import type { ArtworkPresentationState } from '$lib/services/artwork-presentation';
  import { WORKSPACE_RESIZER_WIDTH } from '$lib/services/workspace-layout';
  import type { WorkspaceShellState } from '$lib/services/workspace-shell';
  import type { MultiplayerClient } from '$lib/services/multiplayer-types';
  import type {
    AppearanceSettings,
    BackdropZoneArtworkSettingsMap,
    BackdropZoneEffect,
    MediaTabKind,
    TrackItem,
    VideoFitMode,
    WorkspacePanelId,
    WorkspaceTab
  } from '$lib/types';
  import NowPlayingWorkspace from './NowPlayingWorkspace.svelte';
  import WideWorkspace from './WideWorkspace.svelte';
  import type {
    WideWorkspaceResizeStartDetail,
    WorkspaceTabContentProps,
    WorkspaceTabMoveDetail
  } from './types';

  function clampVolume(volume: number): number {
    return Math.min(Math.max(volume, 0), 1);
  }

  export let content: WorkspaceTabContentProps;
  export let mediaTheaterActive = false;
  export let mediaKind: MediaTabKind = 'video';
  export let isNowPlayingLayoutActive: boolean;
  export let workspaceState: WorkspaceShellState;
  export let selectedTrackItem: TrackItem | null;
  export let artworkState: ArtworkPresentationState;
  export let appearance: AppearanceSettings;
  export let multiplayerClients: MultiplayerClient[] = [];
  export let artworkBackgroundBrightByZone: Record<'nowPlaying', boolean> &
    Partial<Record<WorkspacePanelId, boolean>>;
  export let workspaceZoneArtworkBright: Record<WorkspacePanelId, boolean>;
  export let workspaceZoneEffects: Record<WorkspacePanelId, BackdropZoneEffect>;
  export let workspaceZoneArtworkSettings: Pick<
    BackdropZoneArtworkSettingsMap,
    WorkspacePanelId
  >;
  export let onCloseNowPlaying: () => void;
  export let onChromeHiddenChange: (hidden: boolean) => void;
  export let onTabChange: (tab: WorkspaceTab) => void;
  export let onTabClose: (tab: WorkspaceTab) => void;
  export let onTabbedTabMove: (detail: WorkspaceTabMoveDetail) => void;
  export let onWideTabMove: (detail: WorkspaceTabMoveDetail) => void;
  export let onResizeStart: (detail: WideWorkspaceResizeStartDetail) => void;
  export let onTogglePlayback: () => void;
  export let onPreviousTrack: () => void;
  export let onNextTrack: () => void;
  export let onPreviousSubsong: () => void;
  export let onNextSubsong: () => void;
  export let onSeek: (seconds: number) => void;
  export let onVolume: (volume: number) => void;
  export let onMute: () => void;
  export let onShowTrack: (id: string) => void;
  export let onToggleVideoTheater: () => void;
  export let onToggleVideoPictureInPicture: () => void;
  export let onSetVideoFit: (fitMode: VideoFitMode) => void;
  export let onZoomStep: (factor: number) => void;
  export let onResetZoom: () => void;
</script>

{#if isNowPlayingLayoutActive}
  <NowPlayingWorkspace
    {content}
    {mediaTheaterActive}
    track={content.patternTrack}
    selectedTrack={selectedTrackItem}
    artwork={artworkState.displayedArtwork}
    backdropArtwork={artworkState.visibleArtworkBackground}
    artworkBackgroundBright={artworkBackgroundBrightByZone.nowPlaying}
    backdropEffect={appearance.backdropZones.nowPlaying}
    backdropArtworkSettings={appearance.backdropZoneArtwork.nowPlaying}
    activeWorkspaceTab={workspaceState.activeWorkspaceTab}
    workspaceTabs={workspaceState.workspaceTabs}
    {mediaKind}
    panelAutoHideDelaySeconds={appearance.nowPlayingPanelAutoHideDelaySeconds}
    flyoutTransparency={appearance.nowPlayingFlyoutTransparency}
    alwaysUseArtworkPlayerColors={appearance.useNowPlayingArtworkPlayerColors}
    {multiplayerClients}
    showMultiplayerFloaters={appearance.showMultiplayerFloaters}
    multiplayerFloaterSize={appearance.multiplayerFloaterSize}
    multiplayerFloaterMotion={appearance.multiplayerFloaterMotion}
    on:close={onCloseNowPlaying}
    on:chromeHiddenChange={(event) => onChromeHiddenChange(event.detail)}
    on:tabChange={(event) => onTabChange(event.detail)}
    on:tabClose={(event) => onTabClose(event.detail)}
    on:tabMove={(event) => onTabbedTabMove(event.detail)}
    on:toggle={onTogglePlayback}
    on:previous={onPreviousTrack}
    on:next={onNextTrack}
    on:previousSubsong={onPreviousSubsong}
    on:nextSubsong={onNextSubsong}
    on:seek={(event) => onSeek(event.detail)}
    on:volume={(event) => onVolume(event.detail)}
    on:mute={onMute}
    on:showTrack={(event) => onShowTrack(event.detail)}
  />
{:else}
  <WideWorkspace
    {content}
    {mediaKind}
    collapseSingleTabBar={appearance.collapseSingleTabWorkspaceBar !== false}
    workspacePanels={workspaceState.workspacePanels}
    panelWidths={workspaceState.widePanelWidths}
    resizerWidth={WORKSPACE_RESIZER_WIDTH}
    isResizing={workspaceState.isResizing}
    isCompactWorkspace={workspaceState.isCompactWorkspace}
    inactive={mediaTheaterActive}
    backdropArtwork={artworkState.visibleArtworkBackground}
    zoneArtworkBright={workspaceZoneArtworkBright}
    zoneEffects={workspaceZoneEffects}
    zoneArtworkSettings={workspaceZoneArtworkSettings}
    on:seek={(event) => onSeek(event.detail)}
    on:volumeStep={(event) => {
      if (content.playbackSnapshot && !content.playbackSnapshot.muted) {
        onVolume(clampVolume(content.playbackSnapshot.volume + event.detail));
      }
    }}
    on:toggleVideoTheater={onToggleVideoTheater}
    on:togglePictureInPicture={onToggleVideoPictureInPicture}
    on:setVideoFit={(event) => onSetVideoFit(event.detail)}
    on:zoomStep={(event) => onZoomStep(event.detail)}
    on:resetZoom={onResetZoom}
    on:tabChange={(event) => onTabChange(event.detail)}
    on:tabClose={(event) => onTabClose(event.detail)}
    on:tabMove={(event) => onWideTabMove(event.detail)}
    on:resizeStart={(event) => onResizeStart(event.detail)}
  />
{/if}
