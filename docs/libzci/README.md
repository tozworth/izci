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

## Start here

1. Read [the review](review.md) for the actual starting code.
2. Read [the implementation design](scaffolding.md) for the command, decoder,
   buffer, and output flow to implement.
3. Execute [R1](phases.md#r1-make-the-output-path-lossless-and-bounded): a long,
   marked signal must survive a slow output sink exactly, with bounded memory.
4. Continue through the repaired native Opus CLI and an audible browser Opus
   consumer before broadening engine features.

```text
lossless bounded pipeline -> one transport owner -> native reference Opus CLI
  -> same API + reference Opus + output in browser
  -> ordinary formats, modules, and both crude UIs
  -> persistent queue + installed PWA -> catalog, user facts, artwork/images
  -> Raf, loadouts, gapless/transitions -> video -> foreign caller/readiness
  -> server adoption -> existing Svelte shells
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
  independent current/prepared/outgoing/probe/render instances.
- SQLite owns durable domain state on both targets. Real FSA capabilities stay
  in separate IndexedDB storage. Native paths and SAF grants remain genuine
  platform references. Presentation preferences stay outside the engine.
- Library uniqueness, duplicate queue occurrences, per-subsong behavior, user
  facts, metadata, lyrics, patterns, artwork, and images are engine scope.
  Images have independent navigation and never enter the music queue.
- Raf retains useful roles/controls with shared native/WASM implementations.
  Old algorithms, sound, defaults, preset formats, and serialized state need no
  compatibility. Preserve signal ownership and listener-owned DSP.
- Video uses browser codecs and rendering resources under core transport/timing;
  the PWA includes no software video codec bundle. Native FFmpeg is optional.
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
