import { afterEach, describe, expect, it } from 'vitest';
import { appearanceSettings, DEFAULT_APPEARANCE_SETTINGS } from '$lib/stores/appearance-settings';
import { resetOptionsView } from './options-reset';

afterEach(() => appearanceSettings.reset());

describe('Options page reset scope', () => {
  it('resets Backdrops without changing theme or lyrics settings', () => {
    appearanceSettings.update({
      colorThemeMode: 'dark',
      backdropZones: { left: 'both', center: 'artwork', right: 'visualizer', player: 'both', nowPlaying: 'none' },
      backdropZoneArtwork: {
        ...DEFAULT_APPEARANCE_SETTINGS.backdropZoneArtwork,
        left: { blur: 12, brightness: 80 }
      },
      lyrics: { ...DEFAULT_APPEARANCE_SETTINGS.lyrics, displayStyle: 'theater' }
    });

    resetOptionsView('backdrops');

    expect(appearanceSettings.getSnapshot()).toMatchObject({
      colorThemeMode: 'dark',
      backdropZones: DEFAULT_APPEARANCE_SETTINGS.backdropZones,
      backdropZoneArtwork: DEFAULT_APPEARANCE_SETTINGS.backdropZoneArtwork,
      lyrics: { displayStyle: 'theater' }
    });
  });

  it('resets Now Playing without changing unrelated lyrics choices', () => {
    appearanceSettings.update({
      colorThemeMode: 'dark',
      autoNowPlayingOnMaximized: true,
      nowPlayingPanelAutoHideDelaySeconds: 16,
      nowPlayingFlyoutTransparency: 55,
      useNowPlayingArtworkPlayerColors: false,
      lyrics: {
        ...DEFAULT_APPEARANCE_SETTINGS.lyrics,
        displayStyle: 'theater',
        autoTheaterInNowPlaying: false,
        autoFocusInNowPlaying: false
      }
    });

    resetOptionsView('now-playing');

    expect(appearanceSettings.getSnapshot()).toMatchObject({
      colorThemeMode: 'dark',
      autoNowPlayingOnMaximized: DEFAULT_APPEARANCE_SETTINGS.autoNowPlayingOnMaximized,
      nowPlayingPanelAutoHideDelaySeconds: DEFAULT_APPEARANCE_SETTINGS.nowPlayingPanelAutoHideDelaySeconds,
      nowPlayingFlyoutTransparency: DEFAULT_APPEARANCE_SETTINGS.nowPlayingFlyoutTransparency,
      useNowPlayingArtworkPlayerColors: DEFAULT_APPEARANCE_SETTINGS.useNowPlayingArtworkPlayerColors,
      lyrics: {
        displayStyle: 'theater',
        autoTheaterInNowPlaying: DEFAULT_APPEARANCE_SETTINGS.lyrics.autoTheaterInNowPlaying,
        autoFocusInNowPlaying: DEFAULT_APPEARANCE_SETTINGS.lyrics.autoFocusInNowPlaying
      }
    });
  });

  it('resets Lyrics without changing its Now Playing automation choices', () => {
    appearanceSettings.update({
      colorThemeMode: 'dark',
      lyrics: {
        ...DEFAULT_APPEARANCE_SETTINGS.lyrics,
        displayStyle: 'theater',
        theaterDowntimeThresholdSeconds: 25,
        autoTheaterInNowPlaying: false,
        autoFocusInNowPlaying: false
      }
    });

    resetOptionsView('lyrics');

    expect(appearanceSettings.getSnapshot()).toMatchObject({
      colorThemeMode: 'dark',
      lyrics: {
        ...DEFAULT_APPEARANCE_SETTINGS.lyrics,
        autoTheaterInNowPlaying: false,
        autoFocusInNowPlaying: false
      }
    });
  });
});
