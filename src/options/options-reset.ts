import { appearanceSettings, DEFAULT_APPEARANCE_SETTINGS } from '$lib/stores/appearance-settings';
import { metadataSettings } from '$lib/stores/metadata-settings';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import { patternViewerSettings } from '$lib/stores/pattern-viewer-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import { rafSettings } from '$lib/stores/raf-settings';
import { trackSettings } from '$lib/stores/track-settings';
import { videoSettings } from '$lib/stores/video-settings';
import { visualizerSettings } from '$lib/stores/visualizer-settings';
import { multiplayerSettings, DEFAULT_MULTIPLAYER_SETTINGS } from '$lib/stores/multiplayer-settings';
import type { OptionsViewName } from './views';

export function resetOptionsView(view: OptionsViewName): void {
  switch (view) {
    case 'appearance':
      appearanceSettings.reset();
      break;
    case 'backdrops':
      appearanceSettings.update({
        backdropZones: DEFAULT_APPEARANCE_SETTINGS.backdropZones,
        backdropZoneArtwork: DEFAULT_APPEARANCE_SETTINGS.backdropZoneArtwork
      });
      break;
    case 'now-playing': {
      const lyrics = appearanceSettings.getSnapshot().lyrics;
      appearanceSettings.update({
        autoNowPlayingOnMaximized: DEFAULT_APPEARANCE_SETTINGS.autoNowPlayingOnMaximized,
        nowPlayingPanelAutoHideDelaySeconds: DEFAULT_APPEARANCE_SETTINGS.nowPlayingPanelAutoHideDelaySeconds,
        useNowPlayingArtworkPlayerColors: DEFAULT_APPEARANCE_SETTINGS.useNowPlayingArtworkPlayerColors,
        showFreeplayFloaters: DEFAULT_APPEARANCE_SETTINGS.showFreeplayFloaters,
        freeplayFloaterSize: DEFAULT_APPEARANCE_SETTINGS.freeplayFloaterSize,
        freeplayFloaterMotion: DEFAULT_APPEARANCE_SETTINGS.freeplayFloaterMotion,
        lyrics: {
          ...lyrics,
          autoTheaterInNowPlaying: DEFAULT_APPEARANCE_SETTINGS.lyrics.autoTheaterInNowPlaying,
          autoFocusInNowPlaying: DEFAULT_APPEARANCE_SETTINGS.lyrics.autoFocusInNowPlaying
        }
      });
      break;
    }
    case 'lyrics': {
      const lyrics = appearanceSettings.getSnapshot().lyrics;
      appearanceSettings.update({
        lyrics: {
          ...DEFAULT_APPEARANCE_SETTINGS.lyrics,
          autoTheaterInNowPlaying: lyrics.autoTheaterInNowPlaying,
          autoFocusInNowPlaying: lyrics.autoFocusInNowPlaying
        }
      });
      break;
    }
    case 'playback':
      playbackSettings.reset();
      break;
    case 'video':
      videoSettings.reset();
      break;
    case 'visualizer':
      visualizerSettings.reset();
      break;
    case 'patterns':
      patternViewerSettings.reset();
      break;
    case 'raf':
      rafSettings.reset();
      break;
    case 'modules':
      modulePlaybackSettings.reset();
      break;
    case 'tracks':
      trackSettings.reset();
      break;
    case 'metadata':
      metadataSettings.reset();
      break;
    case 'multiplayer':
      multiplayerSettings.reset();
      break;
    case 'cache':
      multiplayerSettings.update({
        multiplayerRenderDiskCacheEnabled: DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderDiskCacheEnabled,
        multiplayerRenderDiskCacheLimitMiB: DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderDiskCacheLimitMiB
      });
      break;
  }
}
