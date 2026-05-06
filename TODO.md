# TODO

Ideas are grouped by rough implementation complexity.

## Small

- Add a compact "copy track info" action for title, artist, album, duration,
  format, and local filename.
- Persist the last active workspace tab independently from wide-layout panel
  visibility so narrow-mode return behavior feels deliberate.
- Library: Add a "Refresh metadata" context menu item for cases where file tags changed on
  disk after the item was imported.
- Improve import result summaries with counts for added, skipped duplicates,
  unsupported files, and permission failures.
- Add Options toggles for showing filename extensions and technical format
  badges in playlist/library rows.
- Add keyboard shortcuts for toggling details, focusing search, and jumping
  between playlist/library/details panels.
- Show a small stale-file/permission indicator when a persisted file handle
  cannot be rehydrated until the user grants access again.

## Medium

- Add subsong navigation and playback, with current subsong shown in the
  player and Media Session metadata.
- Add per-track playback defaults for modules, such as repeat mode or
  interpolation override, stored alongside the playlist/library item.
- Add lightweight playlists saved as named local collections, reusing the
  existing playlist item model and IndexedDB persistence layer.
- Add drag-to-reorder support for wide-layout panels or a reset command for panel
  proportions when the layout becomes awkward.
- Add smarter folder imports that preserve relative folder paths as optional
  metadata for sorting and duplicate review.
- Add a "prepare offline library" pass that verifies persisted file handles and
  metadata hydration status without starting playback.

## Large

- Add gapless/crossfade experiments for streamed formats while preserving
  Howler HTML5 audio mode and avoiding regressions to Chromium media controls.
- Add a queue system separate from the playlist: play next, add to queue, queue
  reorder, and clear queue, with deterministic behavior across shuffle/repeat.
- Add a full module inspector view with message, instruments, samples, patterns,
  subsongs, and live playback position when Chiptune3 data makes it feasible.
- Add waveform/seek preview generation for streamed files using local decoding,
  cached in IndexedDB with clear storage limits and no network dependency.
- Add large-library performance work: virtualized rows, background metadata
  scheduling, batched persistence, and fast search over thousands of tracks.
- Add a tag editing workflow for app-local metadata overrides, kept separate
  from the source files and synced across playlist/library entries.
- Add folder library roots using File System Access directory handles, with
  manual rescan, missing-file detection, and duplicate-safe imports.
- Add visualizer modes that work for both playback paths: native analyzer for
  streamed audio and a module-safe mirrored/metadata-driven fallback for tracker
  playback.
- Add import/export of izci library data as a local JSON backup, excluding
  artwork blobs and handling file-handle limitations clearly.
- Add a storage management screen for IndexedDB size, cached metadata, playback
  history, artwork session cache, and reset actions.
- Add installed-PWA polish: file-launch recovery UI, update-ready prompts, and
  window placement memory where Chromium desktop APIs support it.
