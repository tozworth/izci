# Verification and maturity

[Plan entry point](README.md) · [Phases](phases.md) ·
[Crudes](crudes.md) · [Codebase reference](reference.md)

Verification follows engine behavior and target capabilities. A native build,
WASM compilation, a foreground browser page, and an installed PWA are different
evidence. Record them separately. Do not run builds, servers, browsers, or device
reinstalls without the authorization required by the repository operating guide.

## 1. Verification layers

| Layer | Proves |
| --- | --- |
| Pure domain tests | Identity, queue occurrences, navigation, matching, reconciliation, user facts |
| Shared DSP tests | Effect properties, stability, parameter changes, latency/reset/tails |
| Provider/source contract tests | Codec coverage, trimming/gain, bounded reads, seek/drain/cancel, instance isolation |
| Storage tests | Actual engine SQL, native/OPFS reopening, failed writes, revision publication, registry recovery |
| Native consumer checks | Device output, CLI lifecycle, crude controls, multiple sessions, native binding |
| Browser consumer checks | WASM/buffer wiring, WebCodecs probes, output timing, grants, worker/client lifetime |
| Installed PWA/device checks | Offline assets/update, OS controls, background/screen-off/interruption and recovery |

Use focused tests that would detect a meaningful regression. Port domain
scenarios rather than asserting old JS object shapes, Web Audio node topology,
or localStorage/IDB serialization. Do not create a massive mechanically translated
suite or golden output for every old effect.

## 2. Fixtures and behavioral scenarios

Reuse [fixtures/README.md](../../fixtures/README.md) and its provenance-backed
manifest/generator. Respect its exact toolchain requirements; a skipped media
case is not codec evidence. Add tiny synthetic or verified permissive fixtures
for missing XM/S3M/IT/MO3/AHX/HVL coverage. Personal library playback is useful
local acceptance evidence, not a redistributable CI corpus.

Prioritize Opus: ordinary and chained files, supported channel layouts, metadata,
pre-skip/end trimming, header gain and ReplayGain exactly once, long seeks,
duration, EOF, preparation joins, and changed-file revisions. Add corrupted and
denied/unavailable sources. Measure sample/time behavior; "heard audio" alone
does not establish seeking or gapless correctness.

Cross-target scenarios use stable IDs and expected semantic outcomes: duplicate
queue navigation, rapid seek/load cancellation, failed next-track preparation,
scan ownership, source changes, favorite/subsong membership, rating propagation,
bookmarks, continuous-play counts, and image navigation alongside audio.

Hively requires two simultaneously live native contexts with interleaved state
changes, plus output/inspection isolation. Independent WASM memories and a loop
of sequential opens cannot satisfy that check.

## 3. DSP, timing, and performance

Use generated tones, sweeps, impulses, silence, transients, and stereo signals.
Check EQ response, AGC target/bounds/recovery, maximizer ceiling behavior, stereo
mapping, pitch ratio, bypass/dry-wet, state reset, and effect/rack latency. Compare
the new native and WASM implementations with justified numerical tolerances;
old browser output is a reference, not an acceptance golden.

Exercise varied sample rates/block sizes, live parameter/topology edits,
crossfades, silence/EOF, and device suspension. Inspect the output path for
blocking/allocations and capture actual underruns, bounded queues, memory, and
worst-case processing cost. Establish numerical budgets using declared target
hardware and workloads before closing a phase; do not invent a universal budget
or call an unmeasured path real-time safe.

Video checks include visible A/V sync after seeking and DSP changes, silent video,
bounded frame retention, surface handoff, hidden-video/audio continuation,
decoder loss/reopen, and resource release. Track hardware/software decode
selection where observable without claiming acceleration is guaranteed. Compare
CPU/memory/power indicators against the workload; foreground correctness alone
does not close efficiency or background gates.

## 4. Browser lifecycle and persistence

For each declared browser/device configuration, record ordinary tab and installed
PWA results separately: user activation, pause/resume, seek, lockscreen actions,
background, screen-off, audio interruption, return to foreground, and recovery.
Confirm audible output/progress, not merely Media Session metadata or buttons.
Emulator/desktop success does not establish Android real-device behavior.

Exercise offline cold launch, all WASM/worklet/provider assets, updates with a
long-lived window, attached-client reconnect, database-owner loss, and clean
shutdown/reopen. Test actual engine SQL under OPFS, failed initialization without
data destruction, busy/quota/access failures, and FSA registry orphan recovery.
Preserve the normal player's profile and grants.

Track capability reports and optional-feature absence on other browsers rather
than assuming Chromium-only APIs universally exist. If persistent OPFS or a
codec configuration is unavailable, show a clear unsupported result or an
explicit nonpersistent test mode. No silent durable-success claims and no
software-video bundle fallback.

## Core maturity gate

Before server adoption and then existing-shell migration:

- [ ] CLI/native crude use libzci without a JS runtime, browser, or webview.
- [ ] Crude PWA independently exercises the actual WASM engine, browser providers,
  sources, DSP/output, SQLite, and offline/lifecycle mechanisms.
- [ ] Mandatory Opus and declared ordinary/module formats have codec, seek,
  preparation, EOF, and instance-isolation evidence; remaining fixture gaps are
  explicit and do not hide mandatory failures.
- [ ] Catalog, queue occurrences, favorites/ratings/bookmarks/counts, scans,
  settings, metadata, artwork/images, and useful Raf controls are public APIs.
- [ ] Native and browser run one shared domain/SQL model and DSP implementation;
  consumers contain no corrective business logic or direct domain SQL.
- [ ] Multiple independent sessions and device-free rendering are exercised;
  shared resources remain bounded and do not route through a global player.
- [ ] Cancellation, stale-output rejection, source/grant loss, database errors,
  decoder loss, and output interruption have observable recovery behavior.
- [ ] Browser video uses platform codecs/surfaces coordinated by libzci, with
  measured A/V timing, hidden-surface behavior, and bounded resource ownership.
- [ ] Installed/offline/update, Media Session, background/screen-off, and target
  device behavior have recorded results; limitations are explicitly scoped.
- [ ] Native/WASM dependency provenance, target exclusions, profile/schema/API
  identities, and resource lifetimes are documented and reproducible.
- [ ] No pre-libzci readers/import/migration/preset conversion or cross-generation
  backup/restore machinery was introduced; old profiles were not wiped.

The gate measures independent usefulness, not pixel parity with the existing
shells. Do not silently waive mandatory browser/core behavior to start migrating
Svelte. Scope changes need an explicit recorded decision.

## 5. Evidence format

Create `docs/libzci/implementation-log.md` in Phase 0.1. Track each numbered
subphase as not started, implemented with verification pending, or verified.
The initial log records the checkout and missing inputs; it cannot contain
playback results or a profile because those do not exist yet.

For a check record subphase/scenario, commit/API identity, exact command or crude
interaction, target/toolchain, browser/device, fixture ID/path, result, relevant
measurements, and limitations. Profile is `none` before storage; afterwards use
the actual isolated profile name. Differentiate passed, failed, unsupported, and
not run. Link detailed logs only
when useful; avoid dumping sensitive paths, file contents, tokens, or signaling
data. This plan itself is not evidence that any implementation gate passed.

The first cross-target scenarios are concrete:

| Introduced in | Scenario | Required observation |
| --- | --- | --- |
| 1.1 | Delayed decode, then seek/dispose | Old-generation results are rejected/released; no observer update after disposal |
| 1.2–1.3 | Reference Opus open/EOF/seek on native and browser | Provider version, bounded reads, finite PCM, audible sample count/timing, release |
| 1.4 | Interleave two Hively contexts | Seek/subsong/mute/dispose on A does not mutate B; silent lifecycle alone does not prove sound |
| 2.1–2.4 | Audible transport on both outputs | Requested/running state, consumed-frame clock, pause/seek/drain and underruns |
| 3.2 | Shared SQL setting/queue commit and reopen | Same core statements, committed revision, persisted order/duplicates, failed write unchanged |
| 3.3 | Two windows and owner loss | One engine/output/SQL owner, snapshot reconnect, paused durable recovery |
| 3.4 | Installed PWA offline/background/update | Actual required assets, coherent version, audible output and OS actions recorded separately |

Use these scenarios to identify the first tests, not to build a second generic
test framework. Existing Vitest tests validate the old runtime; a passing old
test does not verify the corresponding new Rust/browser implementation.
