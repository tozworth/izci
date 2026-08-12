# Main Options settings

`OptionsContent.svelte` is shared by desktop Options and `MobileOptionsView`.
Rows cite the focused view containing the `$t(...)` label/hint and conditions.
All page reset behavior is implemented by `OptionsApp.svelte::resetCurrentView`.

## Appearance, Backdrops, Now Playing, and Lyrics

All rows below use `izci.appearance-settings` / channel
`izci.appearance-settings` and `normalizeAppearanceSettings`. The four pages
currently reset the entire store, so each row has the defect “page reset also
resets unrelated appearance subdomains.” Existing normalization coverage is
`appearance-settings.test.ts`; Stage 1 scenarios are `options-field-contract`
and `settings-cross-window`.

| Identity | Presentation | State | Runtime / apply | Evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| `colorThemeMode` | Appearance; `AppearanceView.svelte` theme mode label/hint; all desktop/mobile | default `system`; system/light/dark | `theme.ts`; immediate | normalization partly covered; CDP required | Preserve; broad-reset defect |
| `lightColorTheme` | Appearance; light-theme select; shown for system/light | default `pale`; light-capable themes | `theme.ts`; immediate | gap per variant; CDP required | Preserve; broad-reset defect |
| `darkColorTheme` | Appearance; dark-theme select; shown for system/dark | default `pale`; dark-capable themes | `theme.ts`; immediate | gap per variant; CDP required | Preserve; broad-reset defect |
| `chameleonHue` | Appearance; Chameleon hue; conditional on effective Chameleon | default 210; 0–359 integer | `theme.ts`; immediate | `normalizeChameleonHue`; CDP required | Preserve; broad-reset defect |
| `chameleonSaturation` | Appearance; Chameleon saturation; same condition | default 76; 0–100 integer | `theme.ts`; immediate | `normalizeChameleonSaturation`; CDP required | Preserve; broad-reset defect |
| `fontFamily` | Appearance; font picker/local-font UI | default `system`; system/bundled/local family string | `theme.ts`; immediate | normalization gap; local access manual/CDP denial | Preserve; broad-reset defect |
| `useArtworkPlayerColors` | Appearance | false; boolean | `PlayerControls.svelte`; immediate | normalization gap; CDP required | Preserve; broad-reset defect |
| `compactPlayerBar` | Appearance | false; boolean | `PlayerControls.svelte`; immediate | normalization gap; CDP required | Preserve; broad-reset defect |
| `keepLibraryColumnsVisibleInNarrowLayout` | Appearance | false; boolean | `PlaylistPanel.svelte`; immediate | normalization gap; narrow-desktop CDP | Preserve; broad-reset defect |
| `keepEmptyWorkspacePanelsOpen` | Appearance | false; boolean | `workspace-shell.ts`, App; immediate | workspace tests partial; CDP | Preserve; broad-reset defect |
| `showLibraryAlbumArtworkBackdrop` | Appearance | true; boolean | `PlaylistPanel.svelte`; immediate | gap; CDP | Preserve; broad-reset defect |
| `showIdlePlayerQuips` | Appearance | true; boolean | `PlayerControls.svelte`; immediate idle state | gap; CDP | Preserve; broad-reset defect |
| `showTrackTitleInWindowTitle` | Appearance | true; boolean | App window-title projection; immediate | gap; CDP | Preserve; broad-reset defect |
| `contextualTabs.lyrics` | Appearance | `manual`; manual/open/open-close | App + `contextual-tab-presentation.ts`; next availability change | focused contextual tests; CDP | Preserve; broad-reset defect |
| `contextualTabs.patterns` | Appearance | `manual`; manual/open/open-close | same; next availability change | focused contextual tests; CDP | Preserve; broad-reset defect |
| `useNowPlayingArtworkPlayerColors` | Now Playing | true; boolean | desktop/mobile workspace player colors; immediate | gap; CDP | Preserve; broad-reset defect |
| `autoNowPlayingOnMaximized` | Now Playing | false; boolean | App/window display projection; next maximize state | window display tests partial; CDP | Preserve; broad-reset defect |
| `nowPlayingPanelAutoHideDelaySeconds` | Now Playing | 5; 2–15 seconds plus 16=`never` | workspace presentation; immediate | normalizer test partial; CDP | Preserve; broad-reset defect |
| `nowPlayingViewActive` | View menu, not Options | false; boolean | App/workspace; immediate menu command | workspace tests partial; CDP | Preserve; clarify reset exposure |
| `lyrics.displayStyle` | Lyrics | `timestamped`; plain/timestamped/theater | lyrics presentation/workspace; immediate | appearance normalization partial; CDP | Preserve; broad-reset defect |
| `lyrics.autoScroll` | Lyrics; rendered only outside Theater | true; boolean | Lyrics panel; immediate | gap; CDP | Preserve; broad-reset defect |
| `lyrics.fontSizes.plain` | Lyrics; style-specific slider | 0.95; 0.78–1.35 step .01 | Lyrics panel; immediate | font-size normalizer; CDP | Preserve; broad-reset defect |
| `lyrics.fontSizes.timestamped` | Lyrics; style-specific slider | 0.95; 0.78–1.35 step .01 | Lyrics panel; immediate | font-size normalizer; CDP | Preserve; broad-reset defect |
| `lyrics.fontSizes.theater` | Lyrics; style-specific slider | 1.75; 0.78–2.6 step .01 | Lyrics panel; immediate | font-size normalizer; CDP | Preserve; broad-reset defect |
| `lyrics.theaterDowntimeDots` | Lyrics; Theater-only | true; boolean | theater lyrics presentation; immediate | gap; CDP | Preserve; broad-reset defect |
| `lyrics.theaterDowntimeThresholdSeconds` | Lyrics; Theater-only, disabled without dots | 10; 5–30 seconds | theater lyrics presentation; immediate | threshold normalizer; CDP | Preserve; broad-reset defect |
| `lyrics.theaterSmoothScroll` | Lyrics; Theater-only | true; boolean | theater lyrics presentation; immediate | gap; reduced-motion CDP | Preserve; broad-reset defect |
| `lyrics.autoTheaterInNowPlaying` | Lyrics | true; boolean | App/workspace mode projection; next Now Playing entry | gap; CDP | Preserve; broad-reset defect |
| `lyrics.autoFocusInNowPlaying` | Lyrics | true; boolean | App/workspace focus projection; next Now Playing entry | gap; CDP | Preserve; broad-reset defect |

Each backdrop identity is presented in `BackdropsView.svelte`; blur/brightness
rows are rendered only when that zone effect includes artwork. Effect choices
are none/artwork/visualizer/both. Blur defaults 36 (0–64), brightness defaults
42 (0–100). Runtime is `app-backdrops.ts` plus the matching zone component,
immediate. Evidence is appearance normalization plus `backdrop-zone-contract`
CDP; all preserve with the same broad-reset defect.

The canonical parent fields are `backdropZones` and `backdropZoneArtwork`; every
persisted child is expanded below. Likewise `contextualTabs` is the canonical
parent expanded above into Lyrics and Patterns controls.

| Zone | Effect identity / default | Blur identity | Brightness identity |
| --- | --- | --- | --- |
| Left | `backdropZones.left` / none | `backdropZoneArtwork.left.blur` | `backdropZoneArtwork.left.brightness` |
| Center | `backdropZones.center` / none | `backdropZoneArtwork.center.blur` | `backdropZoneArtwork.center.brightness` |
| Right | `backdropZones.right` / none | `backdropZoneArtwork.right.blur` | `backdropZoneArtwork.right.brightness` |
| Player Bar | `backdropZones.player` / none | `backdropZoneArtwork.player.blur` | `backdropZoneArtwork.player.brightness` |
| Now Playing | `backdropZones.nowPlaying` / artwork | `backdropZoneArtwork.nowPlaying.blur` | `backdropZoneArtwork.nowPlaying.brightness` |

## Locale

| Identity | Presentation | State / persistence | Runtime | Evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| `locale` | Appearance; `AppearanceView.svelte`; desktop/mobile | default en; en/tr/en-askew; `izci.locale` / channel same; Appearance reset omits it | `i18n/index.ts`; immediate all pages | i18n validation; Stage 1 locale/reset/CDP | Preserve; decide/fix reset semantics |

## Playback

All use `izci.playback-settings` / `izci-playback-settings`, normalization in
`playback-settings.ts`, full-page reset, and UI in `PlaybackView.svelte` unless
noted. Unit source is `playback-settings.test.ts`; CDP scenario is
`playback-setting-runtime`. For every row, the identity-specific title/hint and
advanced state are the `$t('options.playback...')` calls surrounding its control
in that view; the Condition column records additional enable/visibility rules.

| Identity | State | Condition | Runtime / apply | Evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| `playbackRate` | 1; .5–2 step .05 | always | controller -> Howler/video/Media Session/loadout; immediate | normalizer covered; CDP | Preserve |
| `trueSpeed` | false; boolean | always | controller -> pitch preservation; immediate | normalization partial; CDP | Preserve |
| `restartCurrentTrackOnPrevious` | true; boolean | always | `playback-commands.ts`; next Previous | command tests exist; CDP | Preserve |
| `gaplessPlayback` | true; boolean | always | controller preparation policy; immediate/next transition | normalization tests; CDP | Preserve |
| `transitionMode` | none; none/fadeout/crossfade | crossfade normalized to fadeout without gapless | playback commands/controller; next transition | transition tests; CDP matrix | Preserve |
| `fadeDurationSeconds` | 5; .5–30 step .5 | disabled when transition none | controller; next transition | normalizer covered; fake clock + CDP | Preserve |
| `manualTrackChangeFadePercent` | 0; 0–100 step 5 | disabled when transition none | playback commands; next manual transition | normalizer covered; CDP | Preserve |
| `logarithmicVolume` | true; boolean | always | volume/controller/Howler fallback; immediate | volume tests; CDP graph | Preserve |
| `replayGainMode` | track; track/album/off | always | controller/Howler/loadout; immediate/current stream | normalization partial; CDP | Preserve |
| `restoreMode` | disabled; disabled/position/position-and-state | always | restoration service; shutdown/reload | restoration tests; CDP reload | Preserve |
| `rememberProgressDurationIndex` | index 4 = 30 min; off/every/5/15/30/60/120/300/600 | always | progress service; next checkpoint/load | progress tests; CDP reload | Preserve |
| `enableRaf` | false; boolean | always | App/Raf engine and Raf-page gate; immediate | Raf tests partial; CDP graph | Preserve |
| `showRafToggleInPlayerBar` | false; boolean | feature-relevant | Player bar; immediate | gap; CDP | Preserve |

## Video

All use `izci.video-settings` / `izci-video-settings`, normalization in
`video-settings.ts`, full-store reset, `video-settings.test.ts`, and Stage 1
`video-setting-runtime`.

| Identity | Presentation | State | Runtime / apply | Disposition |
| --- | --- | --- | --- | --- |
| `autoResizeWindow` | Video Options | false; boolean | App + `window-video.ts`; next video load/state | Preserve |
| `autoEnterTheater` | Video Options | false; boolean | App/workspace; next video load | Preserve |
| `fitMode` | Video menu only | contain; contain/cover | Video stage/theater; immediate | Preserve; Options reset changes a menu-only field |

## Visualizer

All use `izci.visualizer-settings` / same-named channel, reset whole store,
`VisualizerView.svelte`, `visualizer-settings.ts`, `PlayerVisualizer.svelte`,
and `visualizers/triangles.ts`. Apply is immediate. Unit source is
`visualizer-settings.test.ts` if added (currently gap); Stage 1 scenario is
`visualizer-setting-runtime`.

| Identity | Default / range or choices | Presentation condition | Disposition |
| --- | --- | --- | --- |
| `style` | wave; wave/bars/mirror/blocks/triangles | always | Preserve |
| `colorSource` | theme; theme/artwork | always | Preserve |
| `height` | .78; .22–1 | standard; always shown | Preserve |
| `transparency` | .42; 0–.85 | standard; always shown | Preserve |
| `frameRateLimit` | 60; 30–240 integer | advanced; every style | Preserve |
| `normalizationStrength` | .42; 0–1 | advanced and non-triangle | Preserve |
| `triangleCount` | 64; 8–160 integer | advanced and triangle | Preserve |
| `triangleMinSize` | .14; .04–.8 | advanced and triangle | Preserve |
| `triangleMaxSize` | .56; .08–1.2 and >= min | advanced and triangle | Preserve |
| `triangleBaseSpeed` | 1; .2–3 | advanced and triangle | Preserve |
| `triangleReactiveSpeed` | 1; 0–3 | advanced and triangle | Preserve |
| `triangleBorderWidth` | 1; 0–12 | advanced and triangle | Preserve |

## Patterns

All use `izci.pattern-viewer-settings` / same channel, `PatternsView.svelte`,
`PatternViewer.svelte`, reset whole store, `pattern-viewer-settings.test.ts`, and
Stage 1 `pattern-setting-runtime`. Each row's title/hint and preview exposure are
the identity-specific `$t('options.patterns...')` calls in `PatternsView.svelte`.

| Identity | Default / range or choices | Condition / apply | Disposition |
| --- | --- | --- | --- |
| `fontSize` | 10; 8–16 integer | immediate | Preserve |
| `rowHeight` | 18; 14–28 integer | immediate | Preserve |
| `channelWidth` | 104; 88–160 integer | immediate | Preserve |
| `rowNumberBase` | hex; hex/decimal | immediate | Preserve |
| `colorScheme` | conventional; conventional/theme/monochrome | immediate | Preserve |
| `followPlayback` | true; boolean | immediate | Preserve |
| `alwaysCenterActiveRow` | true; boolean | disabled unless follow | immediate; preserve |
| `smoothScroll` | false; boolean | disabled unless follow | immediate; preserve |
| `showChannelNames` | true; boolean | immediate | Preserve |
| `highlightBeatRows` | true; boolean | immediate | Preserve |

## Module playback

All use `izci.module-playback-settings.v1` /
`izci-module-playback-settings`, reset whole store, `ModulesView.svelte`, and
`module-playback-settings.ts`. Direct normalization tests are currently a gap;
Stage 1 scenario is `module-setting-runtime`. Each row's label/hint/units are the
identity-specific `$t('options.modules...')` calls in `ModulesView.svelte`; all
are exposed through shared desktop/mobile Options.

| Identity | Default / range | Exact runtime / apply | Disposition |
| --- | --- | --- | --- |
| `repeatCount` | 0; -1…32 integer | OpenMPT and Hively `applySettings`; immediate | Preserve |
| `stereoSeparation` | 50; 0…200 integer | OpenMPT immediate; Freeplay snapshot for new renderer; not Hively | Preserve |
| `panStrength` | 100; 0…200 integer | OpenMPT immediate only | Preserve |
| `interpolationFilter` | 1; 1/2/4/8 | OpenMPT and Hively immediate; Freeplay snapshot for new renderer | Preserve |
| `tempoFactor` | 1; .25–4 | OpenMPT immediate only | Preserve |
| `pitchFactor` | 1; .25–4 | OpenMPT immediate only | Preserve |

## Tracks and metadata

Track rows use `izci.track-settings` / same channel, `TracksView.svelte`, whole
reset and `track-settings.test.ts`; metadata rows use `izci.metadata-settings` /
same channel, `MetadataView.svelte`, whole reset and `metadata-settings.test.ts`.
Stage 1 scenarios are `track-setting-runtime` and `metadata-setting-runtime`.
Every row's exact label/hint is the identity-specific `$t('options.tracks...')`
or `$t('options.metadata...')` call in that named view; both views are shared by
desktop/mobile Options.

| Identity | Default / range or choices | Runtime / apply and condition | Disposition |
| --- | --- | --- | --- |
| `folderNestingLimit` | 8; 0–64 integer | next picker/drop/folder scan | Preserve |
| `verifyAddedFiles` | false; boolean | unknown extensions only; next add | Preserve |
| `deduplicatePlaylist` | true; boolean | Playlist additions only; Library always dedupes | Preserve |
| `associatedFileAction` | replace; add/replace | Launch Queue/file handler only | Preserve |
| `showFavoriteToggleInPlayerBar` | false; boolean | Player bar; hidden for joined-client projection | Preserve |
| `enableRatings` | true; boolean | UI/column visibility immediately; stored ratings retained | Preserve |
| `inferFromFilename` | true; boolean | playlist metadata and player controller; next/current metadata merge | Preserve |
| `playCountThresholdSeconds` | 15; 1–3600 integer | play-count service; next continuous interval | Preserve |
