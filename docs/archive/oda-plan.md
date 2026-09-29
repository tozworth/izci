# Oda: ten-foot / couch mode plan

## Goal

Oda is a session-only presentation mode for the main izci window. It keeps the
existing library, queue, playback, DSP, persistence, media-session, and
Multiplayer runtimes alive, but replaces the desktop/mobile presentation with a
remote-first ten-foot interface.

The first layout is a Windows Media Center-inspired text waterfall. Its home
headers are, in order:

`Images`, `Videos`, `Music`, `Now Playing`, `Recents`, `Options`

The focused header is centered and owns a row of rectangular infocards below
it. The home screen is a launcher, not a content feed in the first phases. Most
cards are static destinations with live counts; the Now Playing card is the
exception and shows the current track's artwork and basic state.

Oda is not a workspace layout, a desktop Now Playing variant, or a separate
player. It is another main-window shell over the same application runtime.

## Settled product decisions

- During initial development, Oda is entered from the izci main menu with
  **Enter Oda** and is never restored after a reload or relaunch.
- Oda never renders izci's menu bar or any workspace panels. It also does not
  render the normal bottom player bar.
- Oda may request standard browser fullscreen on entry according to its
  setting. It remains usable if fullscreen is unavailable, denied, or exited
  with the browser's own shortcut. Hiding izci's menu bar is independent of
  fullscreen.
- Oda is exited from `Options > Exit Oda`. Back at the home screen does not
  silently exit the mode.
- Tools, including Logs, are absent. Users must exit Oda to open them.
- Oda has its own synchronized settings store and a normal top-level Options
  category. In ordinary Options it appears in the normal category order. In
  Oda's Options presentation it is moved to the top and selected initially.
- Oda Options is an Oda-native shell over the shared settings content. Opening
  Options must not spawn the desktop Options window.
- Music, video, and image presentation remain distinct. Audio uses Oda Now
  Playing; videos and images use separate, initially simple Oda theaters. This
  preserves room for subtitles and a video-specific control model, and for an
  image thumbnail/gallery experience later.
- Multiplayer setup, chat, connection management, client lists, and other
  Multiplayer-specific UI are omitted. An already-active client session remains
  valid: Oda consumes the same effective host queue, library, playback, and
  artwork state that the main shell already resolves.
- Recents means recently played library items only. It is derived from
  `TrackItem.metadata.lastPlayed`, descending, and excludes items without a
  last-played timestamp.
- The user-facing label stays **Now Playing**. Implementation names should be
  scoped (`OdaNowPlaying`, `OdaVideoTheater`, and so on). Do not add another
  generic "Theater" concept; that term is already used by video and lyrics.

## Scope boundaries

### In the Phase 0-1 MVP

- session entry and exit;
- full replacement of main-window chrome while active;
- waterfall home and static infocards with counts;
- deterministic keyboard/remote navigation;
- music browsing through useful existing library groupings;
- track activation through existing local/Multiplayer-aware commands;
- Oda Now Playing with queue management and transport;
- Oda-native access to all existing Options categories, with a dedicated Oda
  category first;
- separate video and image theater routes that safely host already-playing
  visual media, even if their browse pages remain minimal;
- pointer usability and baseline accessibility without making the design feel
  like a website.

### Explicitly later

- onscreen keyboard and text-entry workflows;
- gamepad polling and vendor-specific remote APIs beyond keyboard events;
- dynamic recommendations or editorial home cards;
- video subtitles and rich video browsing;
- image thumbnails, gallery navigation, slideshows, pan/zoom polish;
- Oda-specific Lyrics, Patterns, Track Details, Multiplayer, or tool UI;
- a persisted "start in Oda" mode. The settings shape can leave room for it,
  but it should not be implemented speculatively.

## Architecture

### Presentation boundary

Keep `createMainWindowRuntime()` as the single runtime. Oda must consume the
already-resolved effective state from `App.svelte` (local state normally, host
state for a Multiplayer client) and dispatch through the same controllers.
It must not create a second queue/library subscription tree, player controller,
media-session connection, or Multiplayer session.

Add a small session controller under `src/lib/services/` that owns only:

- whether Oda is active;
- whether Oda caused the current DOM fullscreen session;
- entry/exit sequencing;
- the current Oda route stack and focus restoration token, or a reference to a
  focused navigation controller that owns those fields.

The active bit is deliberately in memory, not `localStorage`. Persistent Oda
preferences belong in `src/lib/stores/oda-settings.ts`, using the existing
synchronized settings-store convention.

Do not grow `App.svelte` with Oda view logic. Add an `src/oda/` presentation
boundary, analogous to but independent of `src/mobile/`, with an `OdaShell`
composition root, focused view components, and Oda-only styles. `App.svelte`
should select one shell and pass a compact facade of effective state and
commands.

The intended top-level rendering is conceptually:

```text
shared main-window runtime
        |
        +-- standard desktop/mobile shell (Oda inactive)
        |
        +-- OdaShell (Oda active)
```

Player-owned media elements and other nonvisual infrastructure remain shared.
Desktop-only presentation such as `TopMenuBar`, `AppWorkspace`,
`MobileWorkspace`, desktop `VideoTheater`, `PlayerControls`, workspace
backdrops, and tool/Multiplayer chrome must be below the standard-shell branch,
not merely covered by Oda with CSS.

### Oda state and routes

Use explicit route state rather than inferring the view from DOM focus. A
suggested initial model is:

```ts
type OdaRoute =
  | { name: 'home' }
  | { name: 'browse'; medium: 'music' | 'video' | 'image'; view: OdaBrowseView }
  | { name: 'recents' }
  | { name: 'now-playing' }
  | { name: 'video-theater' }
  | { name: 'image-theater' }
  | { name: 'options'; view: OptionsViewName };
```

Keep a small history stack. Each pushed route records the originating focus ID.
Back pops one route and restores that focus after the destination paints. Back
from an Options content page first returns to the Options category list; Back
from the Options landing page returns home. Back from home is consumed and does
nothing.

If the playing item changes to visual media while Oda is active, presentation
routes by kind:

- `stream` and `module` -> Oda Now Playing when Now Playing is requested;
- `video` -> Oda video theater;
- `image` -> Oda image theater.

The Now Playing home card always represents the actual current item. Activating
it dispatches to the kind-appropriate presentation rather than blindly opening
the audio view.

### Effective collections and commands

Oda receives the effective `queueItems`, `libraryItems`, `playingTrack`,
`playbackSnapshot`, selections, artwork, shuffle, and repeat values after the
existing `resolveClient*` logic has run. This is what makes an active
Multiplayer client show the host catalog without any Oda-specific protocol
logic.

All mutations also use the existing aware command paths:

- local/host queue activation goes through `playbackCommands`;
- client activation goes through `multiplayerController.activateTrack`;
- library activation uses the existing library-panel activation facade;
- transport uses the existing `transport` facade;
- queue removal/reordering uses collection/freeplay/client-aware services, not
  direct store mutation.

If the current command facade is too tied to workspace event shapes, extract a
presentation-neutral facade from the existing handlers. Do not duplicate their
branching in Oda components.

### Media filters and counts

Derive these as pure, tested selectors:

- Images: library `kind === 'image'`.
- Videos: library `kind === 'video'`.
- Music: library `kind === 'stream' || kind === 'module'`.
- Recents: library items with a finite `metadata.lastPlayed`, newest first.

Music infocards begin with **Browse music**, followed by shortcuts matching the
existing library concepts: Artists, Albums, Songs, Genres, Years, Formats, and
Folders where useful. Each card shows a count. Counts must be computed from the
music-filtered collection, not the whole library. Group counts mean distinct,
normalized nonempty group values; an `Unknown` group is counted consistently
with the library grouping helper.

Videos and Images initially expose **Browse videos** and **Browse images** with
item counts. Recents shows a browse card and count. Empty destinations remain
focusable and open a proper empty state instead of becoming mysterious disabled
cards.

Prefer sharing or extracting pure library grouping/selecting helpers over
driving the persisted desktop `libraryViewSettings.activeView`. Oda navigation
must not rearrange the user's desktop Library view behind their back.

## Navigation contract

Oda gets first refusal on `keydown` while active. Branch at the main input
boundary before `appShortcuts.handleKeydown()` so unmodified Left/Right never
seek while the user is navigating Oda.

Phase 1 mappings:

| Input | Meaning |
| --- | --- |
| Arrow keys | Move through the current navigation model |
| Enter, Space | OK / activate |
| Escape, Backspace, `BrowserBack` | Back |
| Media Play/Pause, Stop, Previous, Next | Existing transport commands |
| Browser volume keys | Leave to the platform unless izci already receives a media-key action |

Remote aliases should be normalized in one service so later device-specific
keys do not leak into components. Modified shortcuts and text-editing controls
are outside navigation handling unless explicitly supported.

Use a logical focus model with stable focus IDs and view-owned navigation maps.
Do not depend on Chromium's abandoned spatial-navigation behavior or compute
all navigation from element geometry. Geometry can help a reusable grid helper,
but route transitions, waterfall movement, list movement, and cross-region
movement must be deterministic and testable without a browser.

Navigation rules:

- focused elements have a strong, persistent visual treatment, not hover-only
  styling;
- focus is placed deliberately on first entry and restored on Back;
- holding an arrow repeats using the persisted initial delay and repeat interval;
- wraparound is controlled by the Oda setting and defaults off;
- OK events ignore key repeat to prevent duplicate activation;
- pointer activation updates logical focus so keyboard navigation can continue
  naturally;
- dialogs trap focus and Back closes the topmost dismissible dialog;
- native sliders/selects and future text inputs get control-specific handling
  before route navigation.

The waterfall uses Up/Down to change the centered header. Left/Right moves
between that header's cards. OK enters the focused card. A route must never
leave focus on a hidden card after the waterfall animates.

## Oda views

### Home waterfall

The home is one full-viewport composition with restrained animation and a
clear center line. It should be readable at television distance and tolerate
overscan. It should not become a grid of web-style rounded cards, links, hover
effects, or decorative chrome.

Initial cards:

- Images: Browse images + image count.
- Videos: Browse videos + video count.
- Music: Browse music, Artists, Albums, Songs, Genres, Years, Formats, Folders,
  each with its applicable count.
- Now Playing: artwork-backed current-item card; an empty state when idle; OK
  opens the kind-appropriate presentation. A Queue card/count may sit beside it.
- Recents: Browse recently played + count.
- Options: Oda settings, All options, Exit Oda.

Animations must honor `prefers-reduced-motion`. Keep offscreen headers out of
the accessibility tree when they are not meaningful, even if they remain
painted for the waterfall effect.

### Music browser

Phase 1 needs a remote-first list/group browser, not a reuse of the desktop
column table. It consumes pure filtered/grouped data and dispatches activation.
The selected grouping appears as a title/breadcrumb; Back returns through group
levels and then home.

The first complete path is:

`Music > Browse music > track > play > Oda Now Playing`

Artist/album/etc. shortcuts may enter the same browser with an initial grouping.
Lists should virtualize or window rows if the existing library can be large;
do not render the full catalog just because the first test library is small.

### Oda Now Playing and queue

Oda Now Playing is audio-specific. It presents artwork, title/artist/album,
progress, playback state, and a small remote-operable transport. It may show a
queue rail beside the primary panel; this is the deliberate exception to the
"one thing at once" rule.

Phase 1 queue management includes:

- focus and activate an item;
- remove an item where the effective session permits it;
- move/reorder an item where the effective session permits it;
- identify the playing item and preserve focus through queue updates;
- expose shuffle and repeat using existing owners.

Unsupported client mutations must be absent or visibly unavailable, not routed
to local persistence. Freeplay continues through its existing command path.
Context menus are not required for the MVP; a compact action strip or an OK-led
details/action state is more remote-friendly.

### Video and image theaters

Keep separate Oda route components even if their Phase 1 visuals are similar.
Both reuse player-owned elements and shared fit/zoom/rotation commands where
applicable. They do not toggle or reveal the desktop theater/workspace.

Factor the existing media-element hosting/stage behavior if needed, then wrap it
with presentation-specific desktop and Oda controls. Avoid having two visible
hosts or creating a second media element/source node.

Phase 1 can keep controls simple. They may auto-hide after inactivity, but focus
movement or any remote input must reveal them. Back returns to the originating
browse route while playback remains governed by existing behavior. Image
gallery/thumbnails and subtitles remain future work.

### Options

Add `'oda'` to the canonical Options view type/catalog and render its settings
in shared `OptionsContent`. Update reset behavior and advanced-modified
indication with the other categories.

Create an Oda Options presentation rather than stretching desktop
`OptionsView`. It receives the same view definitions and shared content, but
uses a ten-foot category list, breadcrumb, larger control rhythm, and the Oda
navigation controller. In Oda, reorder a derived copy of the category groups so
Oda is first; never mutate the exported canonical groups.

The Oda page initially contains:

- Layout: `Waterfall` (a normalized enum, even while it has one value).
- Enter browser fullscreen when entering Oda.
- Wrap navigation.
- Overscan / safe-area inset.
- Advanced: arrow-repeat initial delay.
- Advanced: arrow-repeat interval.
- Advanced: hold-Back action/threshold. The initial action should be `none` or
  `return-home`; exiting Oda remains an explicit Options command.

Options category navigation uses Up/Down, Right or OK to enter content, and
Back to return to categories. Within content, controls must declare whether
Left/Right adjusts a value or moves focus. All existing categories remain
reachable; components that assume mouse input need focused accessibility fixes
in their existing shared owner rather than Oda-only business logic.

`Options > Exit Oda` is a command, not a persisted setting and not a normal
desktop Options row.

## Fullscreen lifecycle

Entering Oda is triggered by a user gesture from the main menu, so an enabled
fullscreen preference can call the existing fullscreen service immediately.
Entry must still complete if the promise rejects.

Record whether Oda successfully initiated fullscreen. On Exit Oda, leave DOM
fullscreen only when Oda owns it. If the window was already fullscreen before
entry, exiting Oda must preserve that state. If the user presses the browser's
fullscreen escape key, Oda remains active in-window and adjusts its layout.

Do not reuse desktop Now Playing or video-theater active flags as the Oda mode
flag. Their persisted/window-resize side effects are unrelated.

## Settings and persistence

Add a current-version `OdaSettings` type and normalize every property. Suggested
storage is a new `izci.oda-settings` local-storage record with its own
BroadcastChannel. Do not add migrations or compatibility aliases.

Only preferences persist. These do not:

- active/inactive session mode;
- route/history/focus;
- live media/control visibility;
- current counts or derived filters;
- artwork or other presentation snapshots.

Add the Oda settings key to backups only if the existing backup policy includes
all comparable lightweight settings stores; follow that policy rather than
special-casing the feature.

## Phase 0 — establish the shell and navigation foundation

1. Add the Oda settings type/store, normalizers, focused tests, and English and
   Turkish catalog entries. Do not edit `en-askew.json`.
2. Add the session controller with explicit enter, exit, fullscreen ownership,
   and route/focus state. Test rejected fullscreen, pre-existing fullscreen,
   browser-initiated fullscreen exit, and normal exit.
3. Add **Enter Oda** to the main izci menu and route it through a component
   event into the controller. Do not expose it in mobile mode unless a later
   decision explicitly enables that surface.
4. Create `src/oda/OdaShell.svelte` and Oda-only CSS. Switch the composition root
   structurally so standard menu/workspace/player presentation is not mounted
   while Oda is active. Keep shared runtime and player-owned hidden hosts alive.
5. Implement the home waterfall, static destination model, live counts, Now
   Playing artwork card, empty states, pointer activation, reduced motion, and
   safe-area layout.
6. Add the input normalization/navigation controller. Route active Oda input
   before desktop shortcuts and cover focus entry, movement, repeat,
   wrap/no-wrap, activation, Back, modal priority, and focus restoration with
   pure tests.
7. Add route shells for music browse, Now Playing, queue, Options, Recents,
   videos, images, and both visual theaters. No-op routes must still provide a
   title, honest "not available yet" state, and working Back behavior.
8. Add the Oda Options definition and settings page to shared Options. Add the
   Oda-native Options category/content shell with Oda first and `Exit Oda` under
   the Options home.
9. Suppress desktop-only Multiplayer dialogs/toasts and tool entry points in
   Oda. Provide a minimal Oda notice surface for playback errors or other
   critical actionable state rather than letting hidden desktop overlays leak
   through.

Phase 0 is complete when Oda can be entered and exited repeatedly without
interrupting playback; completely replaces visible standard chrome; navigates
every placeholder route using only the Phase 1 keys; behaves correctly when
fullscreen succeeds or fails; and does not persist its active session.

## Phase 1 — complete the first useful couch workflow

1. Extract/test Oda media selectors and grouping counts without modifying
   desktop `libraryViewSettings`.
2. Implement the music browser and its grouping shortcuts with scalable list
   rendering, empty/unknown groups, stable focus, and metadata updates.
3. Route track activation through a presentation-neutral facade covering local,
   cooperative client, and Freeplay behavior. On successful audio activation,
   enter Oda Now Playing.
4. Implement Oda Now Playing and its queue rail with transport, seek, shuffle,
   repeat, activate, remove, and reorder actions subject to current session
   permissions.
5. Ensure a current or newly activated visual item goes to the correct Oda
   theater. Reuse the single player-owned video/image elements and keep desktop
   theater flags and window-resize behavior out of the Oda route.
6. Make every existing Options category reachable through Oda's presentation.
   Fix shared control keyboard behavior where required and verify sliders,
   selects, toggles, nested pages, Advanced tweaks, reset, and Back semantics.
7. Verify active Multiplayer client entry uses the host queue/library/playback,
   performs supported remote commands, hides unsupported mutations, and neither
   reconnects nor reconstructs the session.
8. Add component tests for key presentation states and integration tests for
   the complete keyboard-only path from entry through playback, queue, Options,
   and exit.

Phase 1 is complete when a user can enter Oda from the main menu and, without a
mouse, browse and play music, operate Oda Now Playing, manage the permitted
queue actions, change settings through the Oda-native Options shell, and exit
back to the unchanged standard shell. The same flow must remain coherent during
an already-connected Multiplayer client session.

## Verification checklist

For each source change, run the required `npm run build`. Also run focused tests
for the changed selectors/controllers/stores and `npm run check` for component
and typing work.

Manual browser inspection is intentionally excluded unless requested. When it
is requested, check at minimum:

- installed PWA and normal browser-tab entry;
- fullscreen accepted, denied, and manually exited;
- keyboard-only waterfall, lists, queue, Options, and focus restoration;
- large and empty libraries;
- audio stream, OpenMPT/Hively module, video, and image transitions;
- entering/exiting while playback continues;
- an already-connected Multiplayer client;
- reduced motion and nonzero overscan inset;
- exit restores the standard shell without changing its workspace placement or
  active desktop Library view.

## Principal risks

1. **`App.svelte` composition leakage.** Much of the presentation currently
   surrounds the workspace branch. Oda must create a real shell boundary rather
   than accumulating `!odaActive` checks around individual elements.
2. **Input collisions.** Current unmodified Left/Right seeks globally. Oda input
   must branch before desktop shortcuts, with controls and dialogs getting first
   local handling inside Oda.
3. **Visual element ownership.** Moving the player-owned video/image elements
   between desktop and Oda hosts can accidentally duplicate media elements or
   Web Audio source attachment. Share the element, not the playback backend.
4. **Options scope.** Rendering every current Options page is easy; making every
   control predictable from a directional remote is the substantial part.
   Treat keyboard audits as Phase 1 functionality, not cosmetic polish.
5. **Hidden desktop side effects.** Desktop Now Playing and video-theater state
   include window sizing, auto-entry, backdrop, and fullscreen behavior. Oda
   routes must not toggle those presentation settings accidentally.
6. **Multiplayer mutation routing.** Reading the effective host catalog is
   already centralized, but queue/library actions have several local/client/
   Freeplay branches. Oda should consume one shared command facade so those
   branches cannot drift.
7. **Large-library rendering.** Ten-foot rows are physically large but catalog
   sizes are unchanged. Window lists from the start and preserve focus by item
   identity rather than rendered index.

## Later design hooks

The first implementation should leave narrow, typed extension points for:

- additional Oda layouts selected by the persisted layout enum;
- onscreen keyboard requests from shared Options/search controls;
- gamepad input normalized into the same Oda actions;
- content-driven home cards;
- video subtitle tracks and language selection;
- image gallery/thumbnails and slideshow behavior;
- Oda-native lyrics, patterns, details, search, and Multiplayer status.

These hooks should be types and ownership boundaries, not empty frameworks or
unused abstractions in Phase 0.
