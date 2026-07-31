# Troubadour metadata manager design

## Product direction

Add a standalone metadata manager named **Troubadour** in Tools, window titled **izci Troubadour**.

Troubadour is an offline-first desktop-style workbench for organizing local audio files into albums, editing metadata and embedded artwork, and applying previewed bulk renames. It works through the File System Access API and reuses file and directory handles already known to izci whenever possible.

The interface should take inspiration from MusicBrainz Picard's file-to-album workflow, but Troubadour is not initially a MusicBrainz client. Its first version must be fully useful without an account, backend, or connection.

## Core behavior

- Files, metadata edits, artwork edits, album groupings, and proposed names are staged in a transient workbench.
- Loading, sorting, grouping, and previewing never modify source files.
- **Save** writes changed tags and artwork back to the source file in place. “Export a copy” is not the normal workflow.
- Write access is requested only from a direct user action and only when needed.
- Batch operations show preflight problems, progress, and a result for every file.
- Unknown tags and untouched artwork are preserved even when Troubadour does not display or understand them.
- Successful changes refresh matching playlist, library, favorites, current-track metadata, paths, and handles in izci without changing track IDs or play counts.
- The initial workbench is transient. Troubadour must not become a second persistent music library.
- Settings are lightweight, current-version state synchronized across the Troubadour and Troubadour Options windows.

## Format scope

The first complete version supports in-place metadata and artwork editing for izci's streamed audio formats:

| Format | Initial support |
| --- | --- |
| MP3 | Normalized tags, preserved unmanaged ID3 frames, embedded artwork, in-place write |
| FLAC | Normalized and raw tags, embedded artwork, in-place remux |
| Ogg Vorbis | Normalized and raw comments, artwork where supported, in-place remux |
| Ogg Opus | Normalized and raw comments, artwork where supported, in-place remux |
| WAV | Normalized metadata through WAVE ID3, artwork where supported, in-place remux |

Mixed folder scans may show tracker modules and videos as read-only or unsupported items, but the first version must not invent tagging conventions for modules or promise unverified video metadata writes.

“General metadata manager” means a broad metadata model and multi-file workflow, not that every playable format must immediately be writable.

## Shared izci UI requirements

Troubadour must look like part of izci rather than a separate design system.

- Use the existing context-menu implementation and menu surface. Do not build a Troubadour-specific context menu.
- Use the existing `HoverTooltip` for icon-only and compact toolbar controls.
- Use the existing `TabStrip` for the Metadata and Rename tabs.
- Reuse the existing menu conventions, tool shell styling, theme variables, scrollbars, icons, focus treatment, and Window Controls Overlay behavior.
- Keep components presentational. File access, permission prompts, metadata processing, grouping, writing, and rename jobs belong in services/controllers.

The result should be even more overtly desktop-like than the other tools: conventional menus, a dense toolbar, resizable split panes, trees and grids, keyboard selection, compact status indicators, and a persistent status bar. Avoid cards, hero areas, large rounded panels, decorative links, and responsive layouts that turn the workbench into a website.

## Program shell

The main window consists of:

1. Window/title-bar integration.
2. Conventional **File**, **Edit**, **Album**, **Tools**, and **Help** menus.
3. A small toolbar for add files, add folder, add from izci, create album, auto-group, save, undo, redo, and Options.
4. A `TabStrip` with **Metadata** and **Rename**.
5. The active workbench.
6. A compact status bar showing total/selected/dirty files, permission problems, current path, and active job progress.

Expected shortcuts include:

- `Ctrl+O`: add files
- `Ctrl+Shift+O`: add folder
- `Ctrl+S`: save the selected dirty scope, or all dirty files when selection does not narrow it
- `Ctrl+Shift+S`: save all dirty files
- `Ctrl+Z` / `Ctrl+Y`: undo or redo staged workbench changes
- `Delete`: remove items from the workbench, never from disk
- `F2`: enter the relevant rename action
- `Ctrl+,`: open Troubadour Options
- `F5`: reload unchanged selected files from disk

Undo and redo cover staged metadata, artwork, grouping, ordering, and numbering changes. They do not attempt to reverse already committed file writes.

## Metadata tab

### Layout

The upper work area is split vertically between raw files and albums. A full-width lower inspector contains compact metadata rows and artwork:

```text
+---------------------------+----------------------------------------------+
| Raw files                 | Albums                                       |
| folder/file tree or list  | album -> disc -> track tree                  |
| unassigned / unsupported  | staged state and ordering                    |
+---------------------------+----------------------------------------------+
| Metadata rows                                      | Artwork             |
| field, effective value, original/dirty state       | list and preview    |
+----------------------------------------------------+---------------------+
| status bar                                                               |
+---------------------------------------------------------------------------+
```

All dividers are draggable and retain their proportions. Narrow windows keep a constrained desktop layout rather than changing to stacked cards.

### Raw-files pane

The left pane accepts:

- File and folder pickers
- File/folder drag and drop
- The current izci track
- Selected izci playlist or library tracks
- Remembered izci folders and their existing handles/permissions

It preserves relative paths and parent directory handles needed for later writes and renames. Metadata is read in a bounded background queue and rows update incrementally.

The pane supports hierarchical and flat views, ordinary multi-selection, sorting, context menus, and drag-to-album. Unreadable, unsupported, externally changed, and permission-blocked files remain visible with clear states instead of disappearing.

**Auto-group** uses existing album tags first and folder structure as a configurable fallback. Being assigned to a Troubadour album does not change playlist or library membership.

### Albums pane

The right pane contains transient workbench groups:

- Album -> optional disc -> ordered tracks
- Create, merge, split, dissolve, sort, reorder, change disc, and renumber operations
- Clean, dirty, mixed, conflicted, permission-required, saving, saved, and failed states
- Album-level edits that become explicit patches on affected tracks rather than a separate persistent album record

Manual reordering must not silently rewrite track numbers. Renumbering is a command, with an optional setting to offer it after reorder.

### Metadata inspector

The lower inspector is a dense property grid. It should support at least:

- Title, artist, album artist, album, date
- Track and disc number/total
- Genre, composer, comment, lyrics
- ISRC, BPM, grouping, copyright
- Common sort-name fields
- Advanced raw metadata inspection

Selection behavior:

- One track shows its effective value and original disk value.
- Multiple tracks show a shared value or `<varies>`; edits apply to the selected writable files.
- Album selection aggregates album-oriented fields and applies changes to its tracks.
- Mixed formats expose only safely writable common fields unless the user explicitly applies to supported files only.
- Unsupported files remain inspectable but cannot enter a save job.

Dirty rows can be reset individually. Context menus provide copy, paste, clear, apply to selection, and revert operations. The model must distinguish “no patch” from “explicitly clear this field.”

Unknown raw metadata is preserved regardless of whether the advanced raw view is visible. Arbitrary binary-frame editing is not required initially.

### Artwork inspector

The artwork area provides:

- A compact list of embedded images with kind, MIME type, dimensions, and size
- Preview of the selected image
- Add, replace, remove, extract, copy, paste, and drag/drop
- Front, back, and unknown artwork kinds where supported
- Explicit application of album artwork to selected or all album tracks
- Clear mixed-artwork presentation for multi-file selections

Unedited artwork is preserved byte-for-byte where possible. Editing one artwork slot must not delete untouched secondary images. Oversized images produce a warning; Troubadour does not silently resize or recompress them by default.

Artwork remains transient until written to its source files. It is never added to playlist/library records.

## Rename tab

The second tab is a preview-first bulk renamer operating on loaded files and their effective metadata, including staged values.

Its layout contains:

- A template selector/editor, token menu, scope, and Preview command
- A dense result grid with old path, proposed path, enabled state, and validation result
- Optional details for token expansion and sanitization
- **Apply renames**, **Save tags then rename**, and cancel/progress controls

The first version must reliably rename files within their current directory. Folder templates are enabled only when Troubadour knows and can write to the required parent directories.

The template language should be small, parsed, and deterministic rather than JavaScript. It needs metadata tokens, number padding, simple conditionals, and controlled transforms such as trim, case conversion, slugging, and filename sanitization.

Preview detects all unsafe cases before writing:

- Duplicate job destinations and existing destination files
- Case-only collisions
- Empty or illegal names
- Windows reserved names and trailing spaces/dots
- Missing required metadata
- Unavailable parent handles or write permission
- Sources changed since the preview was generated

Collision behavior defaults to stopping for correction. Skipping or adding a counter may be optional policies; silently overwriting an unrelated destination is not supported.

Prefer a verified native FSA rename when available. Otherwise use a streaming copy to the new entry, verify it, and remove the original only after success. A failed or cancelled rename retains the original. Do not load an entire media file into memory to rename it.

Metadata saving and renaming are distinct commands. **Save tags then rename** explicitly sequences them and regenerates the rename preview after saving.

## File writes and permissions

Troubadour needs a shared normalized metadata model with:

- An immutable snapshot of metadata last read from disk
- Explicit staged patches
- Derived effective metadata
- Preserved format-specific raw metadata
- Targeted artwork edits
- Separate per-file document and job states

Reuse and harden the existing izci metadata/tagging work rather than creating another independent writer. Editor exports, Loudness, and Troubadour should share format adapters and preservation rules where their responsibilities overlap.

Every in-place write follows this contract:

1. Validate the patch and destination format.
2. Re-read the source fingerprint and block on external modification.
3. Query `readwrite` permission.
4. If permission is `prompt`, expose a direct Grant access action and request it from that user activation.
5. Merge edited fields and artwork into the original metadata while preserving everything untouched.
6. Write through an abortable File System Access writable stream; use streaming remuxing where possible.
7. Close to commit, re-read the result, and verify managed fields/artwork.
8. Clear only successfully committed patches and retain failed work for correction or retry.

Writes are sequential by default. Optional bounded concurrency must not race files in the same directory or trigger background permission prompts.

Backups may be an opt-in safety policy, but default behavior remains an in-place write rather than quietly producing copies.

## Synchronization with izci

Troubadour can receive multiple selected tracks from the main window, not only the currently playing track. The handoff includes available file handles, paths, source-folder identity, extension, and kind.

After verified writes or renames, a same-origin result channel informs the main window. The main window then:

- Refreshes matching playlist, library, and favorites metadata
- Replaces file handles and canonical paths after renames
- Preserves IDs and play counts
- Invalidates affected artwork-cache entries for normal rebuilding
- Refreshes media-session/current-track presentation without restarting playback

Do not send artwork blobs through this channel or persist them in collection records.

If the main window is closed, file work may still succeed. Troubadour should not directly mutate collection IndexedDB as a workaround; normal later scans and loading handle reconciliation.

## Shared Options view

Before adding Troubadour Options, generalize the existing izci Options application shell into a reusable **Options view**.

The shared Options view owns the common presentation and behavior:

- Window/title-bar and Window Controls Overlay treatment
- Compact navigation tree and grouped pages
- Breadcrumb/title presentation
- Scrollable content area
- Field-hint expansion
- Advanced-tweaks visibility
- Reset-current-page action
- Window sizing and keyboard/focus behavior
- Existing izci Options styling

It receives view definitions, labels, icons, active-view routing, reset capability, modification state, and page content from its host. It must not import main-player settings or Troubadour settings itself.

Refactor the existing izci Options window to use this shared view without changing its current pages or behavior. Then use the same view for a dedicated Troubadour Options window. Do not copy the Options CSS and markup into a second implementation.

Troubadour owns its own settings schema, routes, synchronization channel, and pages:

### General

- Initial load behavior: current track, current selection, or nothing
- Folder scan depth and metadata-read concurrency
- Auto-grouping and fallback strategy
- Pane proportions and last active tab
- Dirty-item removal confirmation

### Metadata

- Visible field rows and order
- Multi-value and date display
- Album edit application policy
- Reorder/renumber behavior
- Raw-tag visibility and validation severity

Unknown-tag preservation is mandatory, not a setting.

### Artwork

- Default artwork kind
- Size/dimension warnings
- Multiple-image behavior
- Album artwork application default
- Preview presentation

### Rename

- Default template
- Illegal-character replacement and whitespace normalization
- Unicode and extension-case behavior
- Missing-token and collision policies
- Folder-template capability
- Copy verification strength

### Files and safety

- Backup policy
- Post-write verification
- Write concurrency
- External-change behavior
- Continue or stop after a batch error
- Confirmation thresholds for destructive metadata/artwork clears

### Advanced

- Large-file processing thresholds where needed
- Diagnostic job reporting
- Reset all Troubadour settings
- Supported-format and offline/online capability information

Settings changes should affect the open Troubadour window immediately where safe. No compatibility migrations are needed for unreleased settings shapes.

## Future MusicBrainz integration

MusicBrainz integration makes sense as a later, optional enrichment layer. Its API is explicitly intended for taggers and supports searches and lookups for artists, releases, recordings, identifiers, credits, and tracklists; Cover Art Archive can supply release artwork. [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API), [Cover Art Archive API](https://musicbrainz.org/doc/Cover_Art_Archive/API)

Leave the design open for future commands such as:

- Search album/release from the selected workbench album
- Compare local tracks with a candidate release
- Apply selected canonical fields, credits, track positions, and MusicBrainz IDs
- Fetch selected Cover Art Archive images into the staged artwork inspector
- Retain linked release/recording IDs for later refreshes

Online results must always enter the same staged patch model and comparison UI as manual edits. A lookup never writes files automatically, and the local editor remains fully usable offline.

Do not implement the network client in the initial Troubadour work. MusicBrainz currently requires applications to identify themselves meaningfully and stay at or below one request per second. A browser PWA cannot casually assume it can set the required client `User-Agent`, so a compliant direct-browser or optional proxy transport needs a separate design. [MusicBrainz rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)

Keep the future boundary clean: album matching and remote candidates should be a provider interface feeding normalized candidate metadata, not assumptions embedded in the workbench model.

## Architecture boundaries

- A Troubadour controller owns workbench state, selection, commands, undo/redo, and job orchestration.
- Focused services own ingestion, directory traversal, handle resolution, permissions, metadata reading/writing, grouping, artwork lifecycles, renaming, and main-window synchronization.
- Svelte components render controller state and dispatch actions.
- Shared media metadata readers/writers live outside Troubadour so existing tools can use the same preservation logic.
- Shared options presentation is host-agnostic; izci Options and Troubadour Options supply their own pages and settings.
- The settings store contains preferences only. Files, handles, metadata documents, job results, and artwork stay transient.

## Delivery sequence

### 1. Shared foundations

- Generalize the existing Options shell into the shared Options view and confirm existing Options behavior remains unchanged.
- Define the normalized metadata/patch model and format capabilities.
- Consolidate and harden shared metadata readers, mergers, writers, and fixture tests.
- Add readwrite permission and transactional write primitives.

### 2. Troubadour shell and ingestion

- Add the main and Options windows, Tools entry, lifecycle, theme, localization, and main-window handoff.
- Build the desktop shell using existing izci menus/context menus, `HoverTooltip`, and `TabStrip`.
- Add file/folder/drop/selection/remembered-folder ingestion and incremental metadata reads.

### 3. Metadata workbench

- Build raw-files and album panes, selection, drag assignment, grouping, ordering, and numbering.
- Add the metadata property grid, mixed-value editing, validation, undo/redo, and reversion.
- Add artwork inspection and staged artwork operations.

### 4. In-place save and izci refresh

- Add preflight, user-activated permission grants, abortable writes, verification, and per-file results.
- Add external-change conflict handling and main-window synchronization.
- Confirm unrelated metadata/audio and stable izci record state survive writes.

### 5. Bulk rename

- Add the parsed template language, preview grid, sanitization, scopes, and collision checks.
- Add verified native or copy-then-remove FSA rename operations.
- Update workbench and izci handles/paths after success.

### 6. Troubadour Options and polish

- Supply Troubadour pages to the shared Options view and wire synchronized settings.
- Complete keyboard navigation, focus restoration, accessible labeling, compact context menus/tooltips, cancellation, and large-file/folder behavior.
- Run localization, focused tests, full tests, checks, and the required production build.

## Acceptance criteria

- Troubadour opens as one reusable, recognizably desktop-program window with a dedicated Options child using the same generalized Options view as izci Options.
- It uses izci's existing context menu, `HoverTooltip`, and `TabStrip` rather than local substitutes.
- Files can be loaded from pickers, dropped folders, selected/current izci tracks, and remembered FSA roots.
- The Metadata tab has raw files on the left, albums on the right, and compact metadata/artwork inspection below.
- Album and multi-file edits remain staged, visible, undoable, and reversible until saved.
- Save writes verified metadata/artwork in place for MP3, WAV, FLAC, Ogg, and Opus while preserving unrelated tags and encoded audio.
- Permission denial leaves inspection and staging usable without prompting in the background.
- Rename previews reject unsafe destinations and successful renames retain valid handles without loading entire media files into memory.
- izci reflects successful metadata and path changes without losing stable IDs or play counts.
- Troubadour remains completely useful offline while retaining a clean future provider boundary for MusicBrainz and Cover Art Archive enrichment.

## Initially out of scope

- MusicBrainz/Cover Art Archive network implementation in the first release
- Persisting a second library database
- Writable tracker-module metadata
- Video metadata writes until separately designed and fixture-tested
