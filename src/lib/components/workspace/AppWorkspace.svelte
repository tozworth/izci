<script lang="ts">
  import type { Readable } from 'svelte/store';
  import type { ArtworkPresentationState } from '$lib/services/artwork-presentation';
  import type {
    TrackLibraryNavigationTarget,
    TrackLibraryNavigationTargets
  } from '$lib/services/library-navigation';
  import { WORKSPACE_RESIZER_WIDTH } from '$lib/services/workspace-layout';
  import type { WorkspaceShellState } from '$lib/services/workspace-shell';
  import type { AppearanceSettings, BackdropZoneArtworkSettingsMap, BackdropZoneEffect, LyricsDisplayStyle } from '$lib/contracts/appearance-settings';
  import type { ModulePatternSnapshot } from '$lib/contracts/module-playback';
  import type { PlaybackSnapshot } from '$lib/contracts/playback';
  import type { PlaylistItem } from '$lib/contracts/catalog';
  import type { VideoFitMode } from '$lib/contracts/player-settings';
  import type { WorkspacePanelId, WorkspaceTab } from '$lib/contracts/workspace';
  import NowPlayingWorkspace from './NowPlayingWorkspace.svelte';
  import WideWorkspace from './WideWorkspace.svelte';
  import type {
    WideWorkspaceResizeStartDetail,
    VideoSeekFeedback,
    WorkspacePanelHandlers,
    WorkspaceTabMoveDetail
  } from './types';

  $: workspaceContent = {
    snapshotStore,
    playbackSnapshot,
    playlistPanelProps: workspaceState.playlistPanelProps,
    playlistPanelHandlers,
    libraryPanelProps: workspaceState.libraryPanelProps,
    libraryPanelHandlers,
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
  };

  function clampVolume(volume: number): number {
    return Math.min(Math.max(volume, 0), 1);
  }

  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let playbackSnapshot: PlaybackSnapshot;
  export let isNowPlayingLayoutActive: boolean;
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
  export let selectedPlaylistItem: PlaylistItem | null;
  export let playerDisplayTrack: PlaylistItem | null;
  export let lyricsTrack: PlaylistItem | null;
  export let modulePatternSnapshot: ModulePatternSnapshot;
  export let artworkState: ArtworkPresentationState;
  export let detailsLibraryTargets: TrackLibraryNavigationTargets = {};
  export let onNavigateTrackDetailsToLibrary: (target: TrackLibraryNavigationTarget) => void = () => {};
  export let appearance: AppearanceSettings;
  export let artworkBackgroundBrightByZone: Record<'nowPlaying', boolean> &
    Partial<Record<WorkspacePanelId, boolean>>;
  export let workspaceZoneArtworkBright: Record<WorkspacePanelId, boolean>;
  export let workspaceZoneEffects: Record<WorkspacePanelId, BackdropZoneEffect>;
  export let workspaceZoneArtworkSettings: Pick<
    BackdropZoneArtworkSettingsMap,
    WorkspacePanelId
  >;
  export let effectiveLyricsDisplayStyle: LyricsDisplayStyle;
  export let lyricsAutoScroll: boolean;
  export let lyricsFontSize: number;
  export let lyricsResumeAutoScrollToken: number;
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
</script>

{#if isNowPlayingLayoutActive}
  <NowPlayingWorkspace
    content={workspaceContent}
    track={playerDisplayTrack}
    selectedTrack={selectedPlaylistItem}
    artwork={artworkState.displayedArtwork}
    backdropArtwork={artworkState.visibleArtworkBackground}
    artworkBackgroundBright={artworkBackgroundBrightByZone.nowPlaying}
    backdropEffect={appearance.backdropZones.nowPlaying}
    backdropArtworkSettings={appearance.backdropZoneArtwork.nowPlaying}
    activeWorkspaceTab={workspaceState.activeWorkspaceTab}
    workspaceTabs={workspaceState.workspaceTabs}
    panelAutoHideDelaySeconds={appearance.nowPlayingPanelAutoHideDelaySeconds}
    alwaysUseArtworkPlayerColors={appearance.useNowPlayingArtworkPlayerColors}
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
    content={workspaceContent}
    workspacePanels={workspaceState.workspacePanels}
    panelWidths={workspaceState.widePanelWidths}
    resizerWidth={WORKSPACE_RESIZER_WIDTH}
    isResizing={workspaceState.isResizing}
    isCompactWorkspace={workspaceState.isCompactWorkspace}
    {inactive}
    backdropArtwork={artworkState.visibleArtworkBackground}
    zoneArtworkBright={workspaceZoneArtworkBright}
    zoneEffects={workspaceZoneEffects}
    zoneArtworkSettings={workspaceZoneArtworkSettings}
    on:seek={(event) => onSeek(event.detail)}
    on:volumeStep={(event) => {
      if (!playbackSnapshot.muted) {
        onVolume(clampVolume(playbackSnapshot.volume + event.detail));
      }
    }}
    on:toggleVideoTheater={onToggleVideoTheater}
    on:togglePictureInPicture={onToggleVideoPictureInPicture}
    on:setVideoFit={(event) => onSetVideoFit(event.detail)}
    on:tabChange={(event) => onTabChange(event.detail)}
    on:tabClose={(event) => onTabClose(event.detail)}
    on:tabMove={(event) => onWideTabMove(event.detail)}
    on:resizeStart={(event) => onResizeStart(event.detail)}
  />
{/if}
