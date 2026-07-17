import {
  isArtworkBackgroundBrightForBrightness,
  type ArtworkBackgroundAnalysis
} from '$lib/services/artwork-background';
import type { WindowControlsOverlayState } from '$lib/services/window-controls-overlay';
import type { WorkspaceShellState } from '$lib/services/workspace-shell';
import { hasArtworkBackdrop, hasVisualizerBackdrop } from '$lib/stores/appearance-settings';
import type {
  BackdropZoneArtworkSettingsMap,
  BackdropZoneEffect,
  BackdropZoneId,
  BackdropZoneSettings,
  WorkspacePanelId
} from '$lib/types';

interface AppBackdropPresentationInput {
  isNowPlayingLayoutActive: boolean;
  miniModeActive: boolean;
  workspaceState: WorkspaceShellState;
  backdropZones: BackdropZoneSettings;
  backdropZoneArtwork: BackdropZoneArtworkSettingsMap;
  hasVisibleArtworkBackground: boolean;
  artworkBackgroundAnalysis: ArtworkBackgroundAnalysis;
  windowControlsOverlay: WindowControlsOverlayState;
  innerWidth: number;
  innerHeight: number;
}

export interface AppBackdropPresentation {
  isArtworkBackdropRequested: boolean;
  isVisualizerBackdropRequested: boolean;
  isArtworkBackdropActive: boolean;
  artworkBackgroundBrightByZone: Record<BackdropZoneId, boolean>;
  workspaceZoneArtworkBright: Record<WorkspacePanelId, boolean>;
  workspaceZoneEffects: Record<WorkspacePanelId, BackdropZoneEffect>;
  workspaceZoneArtworkSettings: Pick<BackdropZoneArtworkSettingsMap, WorkspacePanelId>;
  geometryKey: string;
}

function resolveZoneArtworkBackgroundBright(
  active: boolean,
  effect: BackdropZoneEffect,
  analysis: ArtworkBackgroundAnalysis,
  brightness: number
): boolean {
  return (
    active &&
    hasArtworkBackdrop(effect) &&
    isArtworkBackgroundBrightForBrightness(analysis, brightness)
  );
}

export function resolveAppBackdropPresentation({
  isNowPlayingLayoutActive,
  miniModeActive,
  workspaceState,
  backdropZones,
  backdropZoneArtwork,
  hasVisibleArtworkBackground,
  artworkBackgroundAnalysis,
  windowControlsOverlay,
  innerWidth,
  innerHeight
}: AppBackdropPresentationInput): AppBackdropPresentation {
  const activeZoneIds: BackdropZoneId[] = isNowPlayingLayoutActive
    ? ['nowPlaying']
    : miniModeActive
      ? ['player']
      : ['left', 'center', 'right', 'player'];
  const activeEffects = activeZoneIds.map((zoneId) => backdropZones[zoneId]);
  const isArtworkBackdropRequested = activeEffects.some(hasArtworkBackdrop);
  const isVisualizerBackdropRequested = activeEffects.some(hasVisualizerBackdrop);
  const isArtworkBackdropActive =
    isArtworkBackdropRequested && hasVisibleArtworkBackground;
  const artworkBackgroundBrightByZone: Record<BackdropZoneId, boolean> = {
    left: resolveZoneArtworkBackgroundBright(
      isArtworkBackdropActive,
      backdropZones.left,
      artworkBackgroundAnalysis,
      backdropZoneArtwork.left.brightness
    ),
    center: resolveZoneArtworkBackgroundBright(
      isArtworkBackdropActive,
      backdropZones.center,
      artworkBackgroundAnalysis,
      backdropZoneArtwork.center.brightness
    ),
    right: resolveZoneArtworkBackgroundBright(
      isArtworkBackdropActive,
      backdropZones.right,
      artworkBackgroundAnalysis,
      backdropZoneArtwork.right.brightness
    ),
    player: resolveZoneArtworkBackgroundBright(
      isArtworkBackdropActive,
      backdropZones.player,
      artworkBackgroundAnalysis,
      backdropZoneArtwork.player.brightness
    ),
    nowPlaying: resolveZoneArtworkBackgroundBright(
      isArtworkBackdropActive,
      backdropZones.nowPlaying,
      artworkBackgroundAnalysis,
      backdropZoneArtwork.nowPlaying.brightness
    )
  };
  const workspaceZoneArtworkBright = {
    left: artworkBackgroundBrightByZone.left,
    center: artworkBackgroundBrightByZone.center,
    right: artworkBackgroundBrightByZone.right
  };
  const workspaceZoneEffects = {
    left: backdropZones.left,
    center: backdropZones.center,
    right: backdropZones.right
  };
  const workspaceZoneArtworkSettings = {
    left: backdropZoneArtwork.left,
    center: backdropZoneArtwork.center,
    right: backdropZoneArtwork.right
  };
  const geometryKey = [
    isNowPlayingLayoutActive
      ? 'now-playing'
      : miniModeActive
        ? 'mini'
        : workspaceState.isCompactWorkspace
          ? 'compact'
          : 'wide',
    workspaceState.activeWorkspaceTab,
    workspaceState.visibleWorkspacePanels.join(','),
    workspaceState.workspaceTabs.map((tab) => tab.id).join(','),
    workspaceState.isDetailsPanelVisible ? 'details-open' : 'details-closed',
    workspaceState.isLyricsPanelVisible ? 'lyrics-open' : 'lyrics-closed',
    backdropZones.left,
    backdropZones.center,
    backdropZones.right,
    backdropZones.player,
    backdropZones.nowPlaying,
    backdropZoneArtwork.left.blur,
    backdropZoneArtwork.left.brightness,
    backdropZoneArtwork.center.blur,
    backdropZoneArtwork.center.brightness,
    backdropZoneArtwork.right.blur,
    backdropZoneArtwork.right.brightness,
    backdropZoneArtwork.player.blur,
    backdropZoneArtwork.player.brightness,
    backdropZoneArtwork.nowPlaying.blur,
    backdropZoneArtwork.nowPlaying.brightness,
    artworkBackgroundBrightByZone.left ? 'left-bright' : 'left-dim',
    artworkBackgroundBrightByZone.center ? 'center-bright' : 'center-dim',
    artworkBackgroundBrightByZone.right ? 'right-bright' : 'right-dim',
    artworkBackgroundBrightByZone.player ? 'player-bright' : 'player-dim',
    artworkBackgroundBrightByZone.nowPlaying ? 'now-playing-bright' : 'now-playing-dim',
    windowControlsOverlay.visible ? 'wco-visible' : 'wco-hidden',
    Math.round(windowControlsOverlay.titlebarAreaRect.x),
    Math.round(windowControlsOverlay.titlebarAreaRect.y),
    Math.round(windowControlsOverlay.titlebarAreaRect.width),
    Math.round(windowControlsOverlay.titlebarAreaRect.height),
    innerWidth,
    innerHeight
  ].join(':');

  return {
    isArtworkBackdropRequested,
    isVisualizerBackdropRequested,
    isArtworkBackdropActive,
    artworkBackgroundBrightByZone,
    workspaceZoneArtworkBright,
    workspaceZoneEffects,
    workspaceZoneArtworkSettings,
    geometryKey
  };
}
