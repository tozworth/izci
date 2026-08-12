# Capability and UX ledger

Disposition is **preserve** unless a row names a defect. Later stages may repair
or deliberately redesign internals without silently dropping the observable
capability.

| Capability | Observable contract | Current owner/evidence | Disposition / gap |
| --- | --- | --- | --- |
| File ingress | File picker, folder picker, file/folder drop, Launch Queue/file association, managed known folders, permission check and re-location | `import-controller.ts`, `file-launch.ts`, `filesystem-folders.ts`, folder scanner, Playlist UI | Preserve; native prompt/launch remain manual residuals |
| Format policy | Stream, OpenMPT, Hively, and video formats use their declared paths; unknown verification is a separate muted OpenMPT probe only when enabled | `types.ts`, `utils/files.ts`, `file-verification.ts` | Preserve internal/manifest allowlist difference |
| Playlist | Ordered duplicate-preserving collection, selection/range/toggle, search, repeat/shuffle/navigation, desktop double-click/context actions | `stores/playlist*`, `PlaylistPanel.svelte` | Preserve |
| Library | Deduplicating collection, favorites, half-star ratings, play counts, nine projections, groups/pins, column order/width/visibility/sort | Collection stores/services, library settings/views | Preserve IDs/counts through folder reconciliation |
| Mobile collections | Touch-first flat rows; tap plays; no desktop selection/double-click model | `MobileWorkspace.svelte`, mobile navigation, playlist panel projections | Preserve bespoke behavior |
| Regular playback | MP3/WAV/FLAC/Ogg/Opus through Howler HTML5, Web Audio adoption with native fallback | Howler backend, player controller | Preserve |
| Tracker playback | OpenMPT and Hively paths, subsongs, metadata, patterns, true module behavior | Module/Hively backends and worklets | Preserve both module families |
| Video playback | Native video surface, shared graph when possible, PiP-safe fallback, contain/cover, theater and window sizing | Video backend/stage/window services | Preserve; browser adoption failures explicit |
| Transport | Play/pause/stop/previous/next, seek/wheel seek, speed/true-speed, end navigation, repeat/shuffle | Player controls, playback commands/controller | Preserve keyboard and Media Session paths |
| Transitions | No transition, fadeout, crossfade, gapless preparation, manual-change fade percentage | Playback settings/commands/controller | Preserve; Stage 1 characterizes supersession |
| Audio processing | Per-source envelope, stream ReplayGain, Raf rack, analyser/visualizer, master volume/mute, logarithmic volume | Audio bus, Raf engine/effects, volume owner | Preserve topology and video Auto Amp-only bypass |
| Resume/history | Bookmarks, periodic progress, restoration mode, Media Session metadata/actions, continuous-play threshold | Focused playback services | Preserve; remote/Freeplay must not accrue local plays |
| Workspace | Dock/move/open/close Playlist, Library, Details, Lyrics, Patterns, Video; tabbed/wide layouts; three resizable panels | Workspace controller/stores/components | Preserve dense desktop behavior |
| Context/Now Playing | Contextual Lyrics/Patterns automation, Now Playing mode, auto maximized behavior/panel hiding, mini-player | Contextual/workspace/mini-player owners | Preserve |
| Backdrops | Per-zone artwork/visualizer/both/none, per-zone blur/brightness and local contrast | Appearance store, backdrop/presentation owners | Preserve menu/title bar theme surface |
| Metadata/details | Embedded/stream/module metadata, filename inference, details projection | `media-metadata/`, module/stream metadata services, Details components | Preserve; characterize source-specific failure |
| Artwork | Embedded/stream/module artwork, palette, bounded rendition cache and presentation | artwork/cache/palette/presentation services | Preserve rebuildable cache and transient URLs |
| Lyrics | Plain/timestamped/theater parsing and presentation | `lyrics.ts`, `lyrics-presentation.ts`, Lyrics components | Preserve transient state |
| Patterns | OpenMPT/Hively pattern grid and playback following | backend pattern snapshots/presentation/components | Preserve transient state |
| Favorites/ratings/play counts | Favorite identity, half-star ratings and continuous-play counts | collection/rating/play-count owners | Preserve storage and threshold rules |
| Window chrome | Custom chrome/WCO geometry, fullscreen, window title and safe fallbacks | WCO/display/fullscreen/title services | Preserve; WCO installed behavior manual residual |
| Popup windows | Named open/reuse/focus, size memory, orphan/parent behavior, mini-player | popup registry/window manager/page roots | Preserve; Troubadour survival is intentional |
| Install/file launch | Install hint, installed detection, file handler and Launch Queue coordination | app install/file launch services | Preserve; installed/file-handler behavior manual residual |
| PWA offline/update | Production-only registration, precache/offline launch, background/manual checks, update apply/restart and Force Update | `vite.config.ts`, `pwa-updates.ts`, About controls | Preserve; autoUpdate/UI conflict is repair defect |
| Settings | Desktop Options popup, shared full-page mobile Options, categories, conditionals, advanced controls, reset and cross-window application | Options views plus focused stores | Preserve all controls; repair reset/sync defects in settings ledger |
| Loadouts | Matchable auto/manual loadouts, category capture and precedence | loadout stores/services/Options | Preserve |
| Backup/restore | Portable settings/library/favorites/progress export/import and relinking | `backups.ts`, Backups view | Preserve exclusions; repair v5/v6 and refresh defects |
| Managed folder relocation | Pending portable folders/loose tracks and user-driven handle relinking | backup/folder owners | Preserve; never persist handles in backup |
| Artwork rendition cache | Bounded internal rendition cache behavior | artwork cache | Preserve rebuildable boundary; future inspect/clear UI is a product decision |
| Multiplayer render cache controls | Host memory and client disk bounds/list/remove/clear | render caches/Cache view | Preserve separate rebuildable boundary |
| Mobile shell | UA/navigator-selected shell, pager order Playlist/Library/Now Playing/Lyrics/Details, bottom nav/swipes/exclusions, drawer and stats | `src/mobile/` | Preserve; narrow desktop remains desktop |
| Audio Compare | A/B sources, synchronized region/loop/loudness match, A-minus-B difference and transport | `src/tools/audio-compare/` | Preserve |
| Blind ABX | 5/10/20 trials, randomized X, A/B/X audition, guesses, score and history | `AudioCompareApp.svelte`, comparison service | Preserve deterministic policy and transient history |
| Editor | Waveform/navigation, clip effects/preview, module render, metadata/lyrics edits, format-aware new-file export | `src/tools/editor/` | Preserve load/render cancellation, preview teardown, picker/download fallback and export failure |
| Converter | Bounded conversion queue, codec/container settings, folder output, metadata policy and collision handling | `src/tools/converter/` | Preserve; active-job page teardown needs ownership |
| Logs | Bounded cross-window log view, levels/columns/sort/filter, copy/export/clear | Logging service/store and Logs tool | Preserve; logs remain transient |
| Troubadour | Transient metadata/artwork/lyrics/loudness/spectrogram/grouping/rename/write workbench and separate Options | `src/tools/troubadour*`, shared metadata I/O | Preserve; disconnected settings are repair defects |
| Multiplayer signaling/session | Host/join/invite/recents/pairing/reconnect/restore/auto-host and Firebase room/directory/TURN exchange | session/signaling/ICE owners | Preserve protocol-18 checkpoint semantics |
| Multiplayer host authority/control | Host catalog/playback projection and client transport/collection commands | host/client/App command adapter | Preserve host authority |
| Multiplayer source delivery | Whole-file ordered-channel transfer and client-native backend | source transfer/playback services | Preserve module-native behavior; bound memory |
| Multiplayer buffered Opus | Host render/cache/scheduler/transfer and client sparse MSE playback | render services | Preserve generation/rebuffer/cache semantics |
| Multiplayer video-source RTP audio | Live RTP audio wire selected for video-kind sources | peer/audio sender owners | Preserve present audio behavior; remote video frames absent/product decision |
| Multiplayer receive/recovery | Receive-audio opt-out/refusal/re-enable, generation recovery and diagnostics | receiver/audio/session owners | Preserve listener-owned processing; fix data-only diagnostics |
| Multiplayer Freeplay | Host library browsing with delivery-specific authority: client-native source-file timeline, host-clocked buffered render, per-peer video-source RTP audio renderer | Freeplay/session stores/services | Preserve isolation from host playlist/player; repair one-last-host persistence into per-pair state |

## Interaction sources cross-checked

- Desktop menus: `TopMenuBar.svelte`, `WindowMenuBar.svelte` and focused menu
  state/services.
- Transport: `PlayerControls.svelte`; collection actions: `PlaylistPanel.svelte`
  and `playlist-panel/` helpers.
- Mobile order and actions: `mobile-navigation.ts`, `MobileWorkspace.svelte`,
  `MobileMenuDrawer.svelte`, and `MobileMultiplayerStats.svelte`.
- Options: `options/views.ts` declares 18 grouped navigable views plus the
  auxiliary licenses view, 19 total; `OptionsContent.svelte` and each view
  implement presentation.
- Popup tools: `popup-windows.ts` and the six tool page roots, including the
  separate Troubadour Options page.

Stage 1 maps every row to deterministic tests, a CDP scenario, or an explicit
manual/device residual. The existence of a menu item is not accepted as runtime
evidence by itself.
