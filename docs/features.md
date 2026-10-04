# izci feature inventory

Reviewed 2026-09-29 against git history through `b2fa55c` (2026-09-28), with changed features checked against current source.

## Playback engines

- Streamed audio (`mp3`, `wav`, `flac`, `ogg`, `opus`) via Howler in HTML5 audio mode
- Tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3`) via the custom libopenmpt WASM controller/worklet
- Hively modules (`ahx`, `hvl`) via dedicated worklet player with pattern data
- Video (`mp4`, `m4v`, `mov`, `webm`, `mkv`) via native video element
- Images (`jpg`, `jpeg`, `png`, `webp`, `avif`) via native image element
- Unknown-extension probe in a separate muted OpenMPT player (optional)
- Per-format playback/display error messages (file access, module decode, video/image decode)

## Transport and player bar

- Previous / play-pause / next with compact-bar mode
- Seek bar with buffered display and time readout
- Volume slider with mute toggle and logarithmic-volume option
- Playback-speed menu with labeled presets
- True-speed toggle (pitch follows speed when on)
- Sleep timer with remaining-time readout
- Stop-after-current-track toggle
- A–B loop with set-start / set-end / stop
- Per-position playback bookmarks with named add/delete
- Resume banner (resumed-at notice, start-over, dismiss)
- Remember-progress by minimum file length
- Restore playback: off, position-only, or position-and-state
- Previous-restarts-track after 3 seconds, press again to skip back
- Idle quips in the empty player bar (optional)
- Favorite heart toggle for track or subsong
- Half-star rating control with clear-rating action
- Raf bypass toggle in player bar with preset picker plus Open-Raf entry on right-click
- Track title in window title (optional)
- Media Session metadata plus media-key handling
- Fullscreen and video/image-theater entry/exit controls

## Keyboard shortcuts

- Enter plays the selected track; Space toggles playback; M toggles mute
- Arrow keys seek ±5 s; Ctrl+arrows step tracks; Ctrl+up/down adjusts volume
- Ctrl+Tab / Ctrl+Shift+Tab cycles workspace tabs
- Alt+Enter toggles fullscreen; F or F11 toggles fullscreen during video; Escape closes Now Playing or the right panel
- Delete removes selected queue/library tracks; Ctrl+A selects all tracks
- Ctrl+O opens files; Ctrl+P opens Options; Ctrl+M toggles the mini player; Ctrl+Q exits

## Queue

- Add files / open folder / drag-and-drop ingest
- Folder nesting-depth limit for folder opens and drops
- Deduplicate queue additions (optional)
- Count plus total-duration summary (search is Library-only)
- Shuffle on/off plus randomize action
- Repeat off / current track / whole queue
- Up Next panel with count, clear, resize, always-show option
- Play-next insertion and remove-from-Up-Next
- Go-to (single track), track-details, copy-filename row actions
- Add/remove row tracks to/from library
- Favorite, rate, and clear-rating row actions
- Separate-subsongs action for multi-song modules
- Queue persists in IndexedDB across windows and restarts

## Library

- Views: All Media, Songs, Images, Videos, Artists, Albums, Genres, Years, Formats, Folders, Favorites, Ratings
- Songs excludes images and videos; dedicated media views have scoped counts and search summaries
- View-tab visibility controls and reordering by drag/drop or Alt+left/right, with persisted order
- Group drill-in with back-to-groups navigation
- Search with scoped summaries and no-results state
- Pin-to-top groups with unpin actions
- Row actions: add/replace queue, play next, go-to, track details, copy filename, favorite, rate, reset play count, remove
- Optional artist/title inference from `Artist - Title.ext` filenames
- Columns: title, artist, album, disc/track, folder, format, year, duration, bitrate, file size, rating, plays, last-played
- Sortable and resizable columns; keep-columns-visible narrow-panel tweak
- Favorites view for tracks and subsongs
- Ratings view (hidden unless ratings enabled)
- Play counts with configurable count-as-played threshold
- Album artwork backdrop behind opened album (optional)
- Library persists in IndexedDB with stable IDs and deduplication
- Managed-folder scans preserving IDs and play counts
- File-open association behavior: add-to-queue or replace-queue
- OS file-association ingest for supported media

## Track details

- Title, artist, album, album artist, composer, genre, year fields
- Disc/track numbers with combined disc/track display
- Format, duration, bitrate, file-size readout
- Image dimensions readout
- ReplayGain track/album values
- Pattern, track, and subsong counts for modules
- Subsong position display with named-subsong support
- Click-through navigation to artist/album/genre/year/format
- Empty-state prompt when nothing is selected

## Lyrics

- Embedded-lyrics reading with reading/error/not-found states
- Plain-text display style
- Timestamped-rows display style with auto-scroll
- Theater display style with smooth scrolling
- Per-style font-size memory
- Downtime break dots with configurable gap threshold
- Instrumental-break marker for long gaps
- Synced-lyrics indicator
- Contextual auto open/close of Lyrics tab (manual, open, open-and-close)

## Tracker patterns

- Live pattern grid with order/pattern/row position readout
- Playhead follow with optional always-center mode
- Smooth playhead scrolling toggle
- Adjustable text size, row height, channel width
- Hexadecimal or decimal row numbers
- Channel names when the module provides them
- Beat-row highlighting every four rows
- Color schemes: conventional tracker, theme, monochrome
- No-module and unsupported-module empty states
- Contextual auto open/close of Patterns tab
- Static pattern-viewer preview in Options

## Video

- Fit-to-window and fill-window viewport modes
- Theater mode with auto-enter option
- Picture-in-Picture button
- Arrow-key seek forward/backward in fixed 5 s steps
- Auto-resize window to 1280×720 on video start with restore after
- Shared Web Audio routing; bypasses Auto Amp only

## Images

- File/folder ingest, queue/library storage, and native image display
- Image tab and full-window image theater with automatic entry
- Fit-to-window and fill-window viewport modes
- Zoom buttons, mouse-wheel zoom, percentage readout, reset zoom
- Drag-to-pan while zoomed, bounded to image edges
- Non-destructive clockwise rotation in 90-degree steps
- Pan and rotation survive theater toggles and reset on image changes
- Image context menu for fit/fill and zoom reset; double-click toggles theater

## Raf effects rack

- Effect chain with add, remove, rename, clone, delete, reorder
- Simple and advanced editor modes for Sloptimizer
- Per-effect bypass, reset, dry/wet mix, global bypass
- Input/output peak meters with clipping indicator
- Named presets with new, rename, delete, save-changes
- Rack import/export via JSON file or clipboard
- Auto Amp with off/reduce/increase/dynamic modes plus target, limits, timing
- Graphic EQ with preamp plus per-band gains
- Stereo Width control
- Multiband Crystalizer with per-band bypass and intensity
- Sloptimizer with Slop macro, lifts, density, speed, upward dynamics, ceiling, crossovers
- Reverb with mix, room, decay, pre-delay, damping
- Pitch shift with phase-vocoder and granular engines plus engine tuning
- Heat saturation with drive, output, color, asymmetry

## Playback behavior options

- Track transition: none, fade-out, or crossfade
- Configurable fade length
- Manual-change fade scaling (off through full duration)
- Gapless next-file preparation (crossfade requires it)
- ReplayGain off / track / album with dB preamp
- Stream ReplayGain applied pre-Raf as deliberate adjustment

## Tracker module options

- Interpolation: 1-tap, 2-tap, 4-tap, 8-tap
- MOD stereo separation with mono-to-hard-stereo range
- Pan strength narrowing/widening control
- Looping: play once or loop forever
- Tempo factor without pitch change
- Pitch factor relative to original tuning

## Appearance, backdrops, visualizer, Now Playing

- Themes: Pale, Lights Out, Solarized, Nordic, Gruvbox, Dracula, Ember, Synthwave, Chameleon
- Follow-system / light / dark appearance modes
- Chameleon hue and saturation tuning
- Synthwave background-brightness scaling
- Artwork-tinted player colors (optional)
- System font or permitted local-font selection
- Interface language switching (English, Turkish)
- Per-zone backdrops (left, center, right, player bar, Now Playing)
- Backdrop source per zone: none, artwork, visualizer, both
- Artwork blur-strength and brightness controls
- Player-background visualizer styles: bars, wave, mirror bloom, pixel blocks, rhythm triangles
- Visualizer color source: theme or artwork palette
- Visualizer height, opacity, frame cap, band normalization
- Rhythm-triangle count, size range, rise speeds, border thickness
- Now Playing open-when-maximized toggle
- Now Playing side-chrome auto-hide timer
- Resizable, pinnable left/right Now Playing flyouts with movable workspace tabs
- Persistent central lyrics/patterns toggles and flyout placement/widths
- Now Playing flyout transparency control
- Multiplayer client floaters for co-op and active Freeplay listeners, with artwork and track/status details
- Draggable floaters with inertia plus size and buoyancy controls
- Now Playing forced artwork colors toggle
- Now Playing auto-Theater lyrics layout
- Now Playing auto-focus-Lyrics option
- Keep-empty-panels-open workspace tweak
- Collapse-single-tab-pane tab-bar tweak
- Always-show-Up-Next tweak

## Loadouts

- Loadout matchers: current file, folder, recognized file type, filename/metadata regex, Raf preset name
- Captured categories: playback, Raf preset, appearance (appearance covers backdrops and visualizer)
- Priority-ordered auto-apply with first-match-wins
- Save-current-settings capture flow with regex validation
- Manual load and update-from-current-settings actions
- Rename, recolor, reorder, delete management
- Per-track and per-folder context matching

## Folders, persistence, backups

- Known-folders table with access, library, last-scan, track counts
- Add folder, forget folder, drag-folders-to-add
- Add-to-library and remove-from-library per folder
- Scan-on-launch toggle plus scan-now action
- Check-access and check-all-access actions
- Locate-missing-folder restore flow
- Full backup create/restore across origins
- Pending-files restore queue with folder and loose-file hints
- Backup contents list with explicit exclusions and unencrypted-data notice
- Lightweight UI/settings state in `localStorage` with cross-window sync

## Workspace and windows

- Dockable tabs: Queue, Library, Details, Lyrics, Patterns, Media (Video/Image), Chat (connected Multiplayer sessions)
- Three-panel layout with resizable proportions
- Empty-panel placeholder and empty-workspace state
- Now Playing full-window view with flyout panels and central lyrics/patterns
- Video and image theater views
- Mini player popup with transport and seek
- Menu groups: Application, File (Session for joined clients), View, Playback, Video (while video is active), Help
- Application menu with Enter Oda, install (when available), Options, loadouts, multiplayer, Troubadour/Compare/Editor/Converter, exit; Help holds Logs, Force update, About
- View-menu checkmarks reflect open workspace tabs
- Update check with available/up-to-date/failed states and force-update
- Popup window reuse and focus behavior
- Desktop-window video sizing with restore

## PWA and system integration

- Installable offline-first PWA with production-only service worker
- Conservative OS file-handler associations
- Window Controls Overlay support with live geometry reaction
- Document Picture-in-Picture where available
- Safe degradation for missing platform features

## Mobile mode

- User-agent-based mobile shell separate from desktop CSS
- Pager order: Queue, Library, Now Playing, Lyrics, Track Details
- Bottom-nav taps plus horizontal page swipes
- Touch-first rows with tap-to-play
- Full-page mobile Options presentation
- Menu access to image/video display and connected-session Chat
- Tool windows hidden in mobile mode

## Oda (couch mode)

- Session-only ten-foot desktop shell, entered from Application and exited through Options > Exit Oda
- Direct entry through `/oda` or `#oda`, consuming the marker so reload returns to the standard shell
- Optional fullscreen entry, with a first-keypress retry after deep-link launch
- Waterfall home with media counts, music groups, images, videos, recently played, Now Playing, and Options
- Library browsing by songs, artists, albums, genres, years, formats, and folders
- List/artwork-grid layouts; image/video browsers also offer a gallery layout
- Remembered browser layout and item size per medium/layout
- Image and video thumbnails backed by a separate bounded, rebuildable IndexedDB thumbnail cache
- Keyboard/remote directional navigation, OK/Back aliases, media keys, and remembered route focus
- Wrap navigation, overscan inset, held-arrow repeat timing, and hold-Back-to-home tweaks
- Now Playing with artwork, transport, seek, volume, shuffle/repeat, and timestamped lyrics with seek-to-line
- Shared queue flyout in Now Playing and theaters
- Dedicated image/video theaters with auto-hiding controls and fit/fill selection
- Oda-native shared Options presentation with Oda settings first
- Custom background image and opacity; optional host-background sync for Multiplayer clients
- Idle screensaver with shuffled library images, theme fallback, clock/date and Now Playing text, and optional text relocation
- Multiplayer home cards and Oda-native host/join/leave dialogs over the shared player/session

## Multiplayer

- Modes: singleplayer, co-op, co-op-plus-audio, freeplay
- Dedicated Multiplayer and Hosting Options pages; singleplayer is the default and Freeplay is marked experimental
- Self-hosted izci-server signaling with WebRTC data channels for peer traffic; official builds have no configured server
- Host setup with server address, operator-key verification and per-server key storage
- Server description, operator contact, declared ICE providers, and room-limit readouts
- Browser-hosted rooms with copyable invitation links, invitation rotation, room close, and remembered-room resume
- Dedicated-server invitation retrieval for authenticated operators
- Join popup accepts invitation links/payloads and offers co-op or Freeplay before connecting
- Remembered recent hosts and stable local device identity
- Custom device name shown to peers
- Pair/unpair clients with reconnect proofs over WebRTC
- Co-op remote queue and transport control
- Co-op-plus-audio host listening with receive-audio toggle and autoplay-blocked resume action
- Freeplay independent per-client host-side renderer, queue, and timeline; requires opt-in at both ends, with pairing optional
- Track context menus remain available to joined clients, including Send to chat
- Audio delivery: source files (including videos) or buffered Opus renders over data channels
- Listener-owned ReplayGain, Raf, analysis, and volume
- Synchronized shared-start playback with configurable lead time
- Wait-for-clients before track start
- Source-file transfer policy: every file, size threshold, or buffered Opus only
- Host Opus VBR bitrate, listener buffer target, host render memory limit
- Persistent client render cache with size limit and per-render removal
- Session restore across relaunch
- Server-managed STUN/TURN with declared-provider review, expiring relay credentials, and prefer-relayed-routes option
- Maximum-guest setting and connection diagnostics for signaling, ICE, NAT, and firewall behavior
- Session readouts: host implementation/version, protocol major/minor, route, delivery mode, and audio bitrate

## Multiplayer chat

- Dockable Chat tab with shared messages, sender names, timestamps, and join/leave notices
- Host message of the day shown above chat
- Playable track links shared from row actions
- `/me` action messages, `/np` current-listening links (including Freeplay), and `/clear` local clearing
- Bounded history delivered to joining peers; optional local host-history preservation with line limit

## izci-server

- Independent self-hosted Go server: `serve` (signaling plus dedicated host), `signal` (browser-host signaling), or `host` (dedicated host against remote signaling)
- Always-on dedicated catalog and playback without running the browser app
- Named filesystem library roots with include/exclude filters, scheduled rescans, stable IDs, metadata, and virtual paths
- SQLite persistence for server identity, catalog, favorites, shared queue/state, room credentials, and pair records
- Shared session plus independent per-client Freeplay sessions with seek, repeat/shuffle, preparation barriers, and synchronized starts
- Source-file delivery with size policy, backpressure, cancellation, and retry
- Buffered Opus/WebM rendering through FFmpeg for audio/video, libopenmpt for tracker modules, and the bundled Hively replayer for AHX/HVL
- Bounded on-disk render cache with LRU eviction, configurable bitrate/encoder concurrency, and shared-session job priority
- Bounded artwork renditions, chat/MOTD/presence history, shared-control policy, and optional automatic pairing
- Operator-key login, leased rooms, rotating invitations, reconnect proofs, and server-issued ICE settings
- Health/readiness endpoints, bounded Prometheus metrics, dependency probes, resource limits, and graceful shutdown
- Docker, Caddy, systemd, and coturn deployment examples

## Audio Compare tool

- Dual sources A/B with open, replace, drag-and-drop
- Synchronized playback limited to overlap duration
- Waveform with selection plus overview seek bar
- Play, pause, stop, loop, loop-selection
- Audition A, audition B, audition-either selector
- Invert polarity, swap L/R, crossfade switch time
- Integrated-loudness measurement with loudness match
- Difference (A−B) monitor for stereo sources
- Blind ABX with trials, references, history, restart
- Cached module-render notice per session

## Editor tool

- Single-file open and drop-to-load
- Two-channel waveform with selection and overview seek
- Zoom, zoom-to-selection, fit-waveform, selection navigation
- Cut, copy, paste, delete, trim-to-selection with history and clipboard state
- Undo/redo with action notices
- Play-from-cursor and play-selection preview
- Offline effects: speed/pitch/tempo, Auto Amp scan, stereo width, Sloptimizer, reverb, pitch, heat
- Edge-blend crossfade for click-free edit boundaries
- Effect preview, cancel, stop, apply-to-selection
- Export dialog with format, bitrate/mode, bit depth, sample rate, channels
- WAV, FLAC, MP3, Opus export notes with metadata/artwork behavior
- Encoder-unavailable and save-failed messaging

## Converter tool

- File and folder ingest with drop support
- Conversion queue with select-all/none, remove, clear-finished
- Output-folder picker with ready-state display
- Audio output: codec, bitrate/mode, sample rate, channels, PCM format
- Video output: codec, bitrate, size, contain/cover/fill fit, frame rate, rotation
- Acceleration: automatic, prefer-hardware, prefer-software
- Container options: fast-start, index-first, fragmented, fragment duration, RF64, Xing header, page/cluster durations
- Metadata format selection with copy-metadata-and-artwork toggle
- Track selection: primary audio/video or all tracks
- Filename suffix, folder-structure preservation, skip-existing
- Parallel-worker jobs with per-job isolation note
- Live codec-support check with unavailable-codec warning
- Per-file status (ready through done/skipped/cancelled/failed) with batch summary

## Loudness tool (Troubadour tab)

- File and folder ingest with drop support
- Parallel analysis jobs with stop action
- Integrated loudness, sample peak, track/album gain columns
- Album grouping: tags-then-folder, folder, all-files, track-only
- Target loudness setting
- Analyze-selected and write-tags-in-place actions
- Per-file status with analyzed count and completion notices

## Spectrogram tool (Troubadour tab)

- Time/frequency/level spectrogram graph with accessible description
- FFT-size selection
- Level-floor range control
- Analyze and stop actions

## Troubadour workbench

- Transient file/folder ingest without touching queue or library
- Initial-load source: current selection, current track, nothing
- Configurable folder scan depth and metadata-read concurrency
- Auto-group by album tags with folder fallback option
- Staged metadata grid with visible-field ordering
- Stored/year-only/localized date display modes
- Validation indicators with warnings-only or all-checks levels
- Raw-tag inspector with binary-size display
- Artwork inspector with mixed-artwork hint and kind selection
- Artwork add/replace/remove/clear, copy/paste/extract, apply-to-album
- Configurable artwork kind default, size/dimension warnings, multi-image policy, album-apply scope
- Timestamped-lyrics editor with stamp/stamp-and-step, sort, ±0.1s shift
- Lyrics line add/delete, timestamp clear, stamped-count progress
- Up/down arrow navigation between lyric rows, preserving the focused text/timestamp/line-number control
- In-window preview player with ±5s seeking where supported
- Rename templates with token/conditional/transform help and album presets
- Rename preview with selection, permission, fingerprint, name, collision checks
- Illegal-character replacement, whitespace normalization, Unicode handling, extension case
- Missing-token and filename-collision policies with counter option
- Copy-fallback verification: size, size-plus-metadata, full hash
- Save with sibling/backup-folder/no-backup policy and post-write verification
- External-change, batch-error, destructive-clear-threshold safeguards
- Album creation, auto-group, renumber, dissolve, assign-to-album
- Undo/redo staged changes with dirty-removal confirmation
- Diagnostic batch summaries forwarded to Logs
- Docking layout with ten-zone compass and reset

## Logs tool

- Live log table with time, level, source, context, message, details
- Level filter: error, warning, info, debug
- Debug capture and console-mirror toggles
- Auto-scroll toggle with entry count
- Column visibility menu, copy-visible, clear-all, export
