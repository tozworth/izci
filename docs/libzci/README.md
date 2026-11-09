# libzci implementation plan

Build an embeddable Rust music/media engine that runs a native player without
JavaScript and an offline PWA through WebAssembly and browser adapters. It will
replace izci's overlapping player, catalog, persistence, and DSP implementations.
The existing shells remain presentation code.

This plan starts from the attempted implementation at `168874dd` on
`libzci-muse`. The [source review](review.md) identifies useful work and defects
to recover. The old [implementation log](implementation-log.md) contains
historical reports, not a declaration that recovery is complete. All milestones
in this replacement roadmap started open. R1 and R2 are verified, and R3 now has
a working reference Opus CLI on Windows MSVC, including hardware/listening checks.
See the [implementation log](implementation-log.md) for target-specific evidence;
R4 reference browser output and headless checks are implemented; actual hidden-tab,
screen-off and physical Android checks remain pending. GNU/Linux recovery remains
unverified target work.

M1 now implements ordinary audio, modules, both crude UIs, independent probe/render
jobs and optional WebCodecs Opus, verified on Windows native/headless Chromium.
The [2026-10-23 validation pass](implementation-log.md#2026-10-23-m1-validation-and-cleanup)
adds Android emulator Chrome coverage and fixes transport/source/job regressions.
Its target-specific evidence and limits are in the implementation log.

M2 now implements the persistent queue/settings API, shared Rust SQL on native
SQLite and browser OPFS, capability registry recovery, browser owner attachment,
and independent offline PWA installation/updates. Windows and installed Chromium
checks pass. External picker grants and physical/background lifecycle acceptance
remain open; see the [M2 evidence](implementation-log.md#2026-10-23-m2-persistent-queue-and-installed-pwa).

## MVP scope (2026-11-09)

The MVP is **Svelte adoption with working playback for most existing formats**,
not full parity with every research goal in this plan. The critical path is
current M3 -> A2. M4-M6 and A1 are post-MVP backlog unless the user explicitly
re-prioritizes them.

Required for MVP:

- The PWA/desktop shells consume libzci for queue, library, persistence and
  ordinary audio/module playback.
- Stream formats already advertised by izci: MP3, WAV, FLAC, OGG/Vorbis and Opus.
- Tracker modules accepted by OpenMPT, plus AHX/HVL through Hively.
- Existing browser `<video>` playback remains presentation-owned during the
  first adoption pass. "Most formats" does not require reimplementing browser
  video demux/decode in core.
- Library membership, favorites/ratings/scans, metadata, lyrics and artwork.
- Real file access, installed/offline behavior and one owner per profile.
- Basic transport/status/control continuity through the Svelte shells. Raf
  parity may use an explicit temporary shell-side bridge until its post-MVP
  migration.

Deferred, and therefore **not acceptance gates** for MVP:

- AVIF, HDR/non-ICC color and formal decoder-heap measurement. PNG/JPEG/WebP and
  the already-implemented JPEG XL path are sufficient for library artwork/images.
- All eight Raf effects, preset/loadout compatibility, gapless/crossfade and
  prepared-source overlap.
- Core WebCodecs/FFmpeg video transport, native video surfaces and hidden-video
  recovery.
- A C ABI or foreign-caller embedding proof.
- izci-server adoption ahead of the Svelte shells.
- Physical Android/background, GNU/Linux, disk-exhaustion and exhaustive
  performance/conformance evidence.

## Start here

Work was paused and the goal cleared on 2026-11-08. See the
[handoff](handoff.md) for the checkout, verified checkpoint, outstanding work and
local setup before continuing in a new chat.

Current work (2026-11-09): M3 is complete for the MVP scope above. Catalog,
scans, metadata/lyrics/ReplayGain, play counts, artwork and image navigation work
through both crudes with SQLite/OPFS and muted Chromium evidence. Optional image
hardening (AVIF/HDR/codec memory accounting) is deferred.

A2 is now **in progress**. Ordinary streams (`mp3`, `wav`, `flac`, `ogg`,
`opus`), OpenMPT tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3`) and Hively
modules (`ahx`, `hvl`) use the libzci `WebEngine`, reference
Opus/Symphonia/modules-reference providers, bounded decode worker and shared
audio worklet, routed through the existing audio bus. Howler has been removed;
the old OpenMPT and Hively audio transports are superseded (the OpenMPT
inspection worker remains for full pattern songs; Hively pattern songs come
from output-free replay-core inspection). Both Svelte transports share one
engine-link runtime (`src/lib/services/libzci/runtime.ts`); generated WASM
now emits to workspace-ignored `libzci/generated/`. Forty-three pure Svelte seams
since then pin the queue/library adoption contract (commands, queries, groups,
bookmarks, image sequences, scan roots/observations, settings, source registry,
facades, owner-client channels including ingest/restore, playback resolution,
play-count/normalization/lyrics/rendition observations, capability/ingest/
durable/access/namespace/transport-guard boundaries, worker protocol with
lifecycle channels, unified store) with typecheck/unit/build evidence but no
live worker yet.
Queue/library persistence cutover, file-access ownership, and the remaining
domain/transport/mobile/Oda wiring are the next slices; the browser video path
stays native. See the latest
[A2 implementation-log entries](implementation-log.md#2026-11-09-a2-forty-third-slice--owner-client-restore-channel).
Preserve ordinary izci profiles/grants throughout adoption; sound checks use
muted/low output.

1. Read the [handoff](handoff.md), [roadmap](phases.md) and
   [MVP readiness gate](validation.md#mvp-svelte-adoption-gate) for the current
   frontier.
2. Use [the review](review.md) as historical context and
   [the implementation design](scaffolding.md) for ownership and API constraints.
3. Inspect current source and relevant evidence, then continue the open milestone.
   Do not restart completed recovery work or infer adoption from passing crude tests.

```text
lossless bounded pipeline -> one transport owner -> native reference Opus CLI
  -> same API + reference Opus + output in browser
  -> ordinary formats, modules, and both crude UIs
  -> persistent queue + installed PWA -> catalog, user facts, artwork/images
  -> Svelte adoption with most existing formats (MVP)
  -> post-MVP backlog: Raf parity -> core video -> C embedding/server adoption
```

Each milestone produces usable behavior through the public API. Recover existing
code where it passes those checks; replace it where its execution or ownership
model prevents them. Early work leaves the old player independent.

## Product decisions carried forward

These are recorded decisions from the original plan. The new sequence preserves
them:

- Native consumers embed compiled Rust/media code and require no JS runtime,
  browser, webview, or WASM interpreter. Core supports multiple sessions and
  device-free rendering; a daemon is optional consumer infrastructure.
- Browser support is a first-class offline PWA, developed beside native. Both
  targets share domain behavior, SQL, and DSP. Browser glue executes platform
  operations rather than becoming another application engine.
- Working reference Opus is mandatory. Use libopus/libopusfile as the recovery
  baseline. WebCodecs audio is optional. Startup-registered providers create
  independent current/probe/render instances; prepared/outgoing overlap belongs
  to the post-MVP gapless work.
- SQLite owns durable domain state on both targets. Real FSA capabilities stay
  in separate IndexedDB storage. Native paths and SAF grants remain genuine
  platform references. Presentation preferences stay outside the engine.
- Library uniqueness, duplicate queue occurrences, per-subsong behavior, user
  facts, metadata, lyrics, patterns, artwork, and images are engine scope.
  Images have independent navigation and never enter the music queue.
- Raf retains useful roles/controls with shared native/WASM implementations.
  Old algorithms, sound, defaults, preset formats, and serialized state need no
  compatibility. This is post-MVP; the first Svelte adoption may use an explicit
  temporary compatibility bridge rather than blocking on all eight effects.
- Video uses browser codecs and rendering resources under core transport/timing;
  the PWA includes no software video codec bundle. Native FFmpeg is optional.
  Core video ownership is post-MVP; preserve the existing browser video path
  during the first adoption pass.
- Create fresh libzci state. No old-state reader, migration, preset conversion,
  dual writing, or cross-generation backup/restore is required. Preserve existing
  profiles/grants while developing the separate engine.
- Themes, visualizers, backdrops, desktop/mobile/Oda interaction, and workspace
  layout remain shells. Tag writing, Troubadour, conversion/workbenches, and a
  public runtime plugin ABI need separate later decisions.
- Server signaling, pairing, admission, permissions, and WebRTC delivery remain
  outside core. Delivery remains source-file or buffered Opus, with independent
  Freeplay sessions; no live RTP pathway is introduced.

[Boundaries](boundaries.md) and [contracts](contracts.md) retain the detailed
behavioral requirements. New implementation defaults are identified in
[scaffolding](scaffolding.md); they are not additional product non-negotiables.

## Executing the plan

Use the [roadmap](phases.md) as the single task sequence,
[consumer behavior](crudes.md) for application controls, and
[validation](validation.md) for concrete evidence. [Reference](reference.md)
links actual source and acquisition inputs.

Follow [AGENTS.md](../../AGENTS.md), including explicit build/runtime
authorization. This revision does not authorize builds, servers, browser
inspection, fixture generation, or launches. A milestone awaiting a required
runtime check stays pending; dependent work cannot treat its unchecked mechanism
as established. Independent work may proceed with its dependency stated.

Commit coherent behavior changes. Record the commit, target, command or
interaction, input, and result that close each milestone. Historical phase
numbers are not the new milestone IDs. Append recovery results under the new IDs
and retain the old log as history.
