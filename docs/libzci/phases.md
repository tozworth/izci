# Implementation roadmap

[Overview](README.md) · [Implementation design](scaffolding.md) ·
[Review](review.md) · [Consumers](crudes.md) · [Checks](validation.md)

Start at `168874dd` with recoverable code, not an empty workspace. The old log's
Phase 2.2 is not this roadmap's starting gate. R1 is verified by the device-free
checks recorded in the [implementation log](implementation-log.md#recovery-r1-bounded-lossless-output--verified).
R2 and native reference Opus R3 are verified on Windows MSVC (2026-10-18);
R4 is implemented with headless end-to-end evidence; hidden-tab/screen-off and
physical-device validation keep its acceptance open. M1 has Windows native and
headless Chromium and Android emulator Chrome evidence. M2 is implemented with
Windows native, OPFS, multi-window, installed/offline and update evidence;
physical-device lifecycle/grant checks remain pending. M3-M6 remain open.
GNU/Linux R3 recovery remains unverified target work. Execute in order; numbered items within a milestone are commit-sized
units where coherent. A milestone closes when its deliverable works and the
listed checks pass, not when its file list exists. Pending verification is a
real dependency, not a pass. See the build/runtime rule in [README](README.md).

## R1: make the output path lossless and bounded

Status: **verified** (2026-10-18, Windows MSVC; pure core/native and queue checks).
Real codecs/devices and browser output remain R3/R4 checks.

**Deliverable:** a long marked PCM source reaches a deliberately slow fake output
exactly once, including converter tails, with fixed retained-memory bounds.
No decoder, GUI, database, device, or browser is needed for this first result.

**Recover:** `audio/{pcm,processor,resampler}.rs` where behavior is useful.
**Replace:** the mutable-Vec ring and output producer loop described in the review.

1. Record baseline commit and dirty files. Identify an available real Rust
   release; keep pure-core checks independent of the C libraries/device. Add
   `tests/output_pipeline.rs` with an integer-marked synthetic source and a sink
   that accepts variable/zero/partial blocks. No sleeping or hardware is needed.
2. Pin native `rtrb = "=0.4.0"` and use unique ready/recycle endpoints over fixed
   block-pool indices. Add generation, source range, layout/rate, and valid length
   descriptors. Keep allocation/deallocation off the callback. This implements
   the common output contract without adding rtrb to browser mechanism code.
3. Implement pending-block state and credits. Keep any unwritten suffix. Decode
   another block only when downstream budgets allow it; retain/resume converter
   output the same way. Define explicit source EOF, converter draining, and final
   output completion. Count retained bytes/frames including staging and tails.
4. Make flush a consumer-owned generation switch/acknowledgment, with stale block
   release. Remove producer-side cursor reset. Ensure full queues do not prevent
   stop/dispose delivery. Test teardown while blocked on capacity.
5. Replace native pipeline pushes with this flow. Keep any fake sink confined to
   tests. Preserve shared sample validation, channel mapping, and gain semantics.

**Close with:** exact sample/order equality for a source at least ten times the
queue capacity under full/partial/empty sink schedules; no missing/duplicate
tail at matched and mismatched rates; bounded high-water marks; stale generation
rejection during reset; concurrent producer/consumer stress. Run the selected
queue's relevant safety checks where available. Sequential ring tests alone
cannot establish concurrency safety.

## R2: make commands, decode jobs, and output one transport

Status: **verified** (2026-10-18, Windows MSVC). See the [recovery evidence](implementation-log.md).

**Deliverable:** a small native test harness and the existing CLI exercise one
public transport API. A held decode job cannot block a second session or Stop.

**Change:** `session.rs`, `command.rs`, `event.rs`, native `runtime.rs` and
`playback.rs`; introduce focused `session_jobs.rs` / `audio/renderer.rs` only
as their operations are implemented. Reuse worker/binding names where practical.

1. Implement the session state machine/action flow from [design](scaffolding.md#2-public-operations-and-one-session-owner).
   Put source identity in Load; include start time/subsong options. Add public
   volume/mute and module capability operations. Centralize frame/time conversion.
2. Move decoder ownership to sequential job workers. Commands accept/invalidate
   promptly; jobs return operation/instance/generation-tagged outcomes. Release
   map locks after lookup. Wire actual cancellation tokens to source/provider
   work, including jobs blocked by output capacity.
3. Distinguish Data, Pending, EOF, and Failed. Core owns Play/Pause/Stop/Seek and
   requested-vs-running state. Adapters perform requested device operations and
   return their outcomes; remove separately authoritative output pause flags.
4. Connect consumption spans to a shared media clock. Keep decoder position and
   underrun/device progress separate. Re-anchor on seek, freeze on pause/suspend,
   and enter Ended only after final media consumption. Propagate device/decoder
   failures through command outcomes and snapshots.
5. Implement incremental render jobs with explicit processing mode, progress,
   bounded chunks, cancel, and final result. Connect Ctrl-C during load/seek/render
   as well as playback. Dispose sessions/output/jobs without retained thread cycles.
6. Remove CLI `open_with_subsong`, concrete decoder imports, hardcoded public
   48 kHz seek math, and whole-file `render_to_vec` use. CLI flags issue the same
   public operations available to a second consumer.

**Close with:** Play/Pause/Seek/Stop/Dispose through the API alone; a delayed job
plus rapid seeks, new load, and dispose cannot commit stale media; a blocked
session does not obstruct another; feed starvation is Pending; EOF/drain are
distinct; underrun silence never advances media position; cancel terminates a
long streaming render with bounded retained memory. Test generation changes
after decode but before consumption, not only before decode starts.

## R3: recover a dependable native reference Opus CLI

Status: **verified for x86_64-pc-windows-msvc** (2026-10-18), including
quantitative reference checks, full device playback, interruption and user-confirmed
clean listening. GNU/Linux recipes are retained but have not been re-run here;
no Linux or browser runtime success is inferred. See the [recovery evidence](implementation-log.md).

**Deliverable:** `zci-play file.opus` plays a long source to its real end;
`--start`, volume, interruption, and streaming `--render-pcm` use the same API.

1. Reproduce acquisition inputs from `vendor/dependencies.json`. Audit digests,
   notices, output paths, compiler versions, and static link inputs. Make missing
   prerequisites actionable. Keep pure core test execution separate from codec
   acquisition. Preserve ordinary izci WASM/profile/grant state.
2. Wrap the pinned libopusfile C API with owned callback context and handles:
   bounded source reads/seek, float decode, seek, comments, error, close. Register
   it through the provider boundary. Use explicit header-gain mode and zero
   additional offset. Report provider-applied trim/gain once.
3. Compare the existing raw-libopus path and its tests against this baseline.
   Keep useful fixtures/Ogg helpers; retire competing production seek/timeline
   code once the baseline passes. Expand Opus tests to stereo/mono, pre-skip,
   end trim, seek at zero/middle/EOF, corrupt/truncated files, header gain,
   ReplayGain/R128 tag reporting, and chained Ogg. Declare channel-map limits.
4. Negotiate supported CPAL sample formats/rates/channels; convert output samples
   explicitly. Do not reject a valid device solely because its default is not
   F32 stereo. Apply shared gain/mute at output. Send device errors/state/timing
   facts back to the owner. Test pause, seek, final drain, and disposal on hardware.
5. Keep existing GNU/Linux recipes as the first acquisition path. Add explicit
   target-aware archive/runtime linking and a Windows acquisition path rather
   than claiming GNU `.a`/`stdc++` linkage is portable. Record each target's real
   build/run status; unverified Windows remains open target work, not a Linux
   success. The next browser proof may proceed independently of Windows recipes.
6. Update actual CLI help/run instructions and export format. Exit 0 only for
   completed playback/render, 130 for interruption, and nonzero for typed failure.

**Close with:** long marked Opus output through R1's accounting with no media
drops; correct start/seek tail lengths; rendered bytes agree with the reference
timeline; timely Ctrl-C; two live provider instances; native dependency inspection
shows no JS/webview/WASM runtime. Listen on hardware and retain quantitative
evidence separately. Reproduce the clean-checkout recipe on each declared target.

## R4: the same reference Opus player works in the browser

Status: **implemented; checks pending** (2026-10-19). Windows headless Chromium
passes real File/reference/output, native sample comparisons, starvation,
backpressure, transport and failure checks. True background/screen-off, hardware
listening and physical Android remain unverified; headless tabs remained visible.
See [R4 evidence](implementation-log.md#recovery-r4-reference-browser-player--implemented-checks-pending).

**Deliverable:** the existing crude page opens a real File and audibly plays,
pauses, seeks, stops, and renders diagnostics through the repaired core API.
It works with WebCodecs AudioDecoder disabled/unavailable.

1. Add reproducible pinned Emscripten builds/exports for the reference C codec;
   keep Rust control and audio-only WASM builds separate. Wire one engine worker,
   decode job worker, and output worklet. Use the same session machine as native;
   replace the current browser-specific transport/seek implementation.
2. Prove bounded FileReaderSync C callbacks in the decode worker first: fixture
   open/decode/seek/close, long source reads, error propagation, callback reentry,
   cancellation between calls. Yield between scan/probe batches. Follow the
   [scoped fallback decision](scaffolding.md#6-reference-codecs-and-browser-assembly)
   only if an actual mechanism failure is recorded.
3. Use explicit credits/recycling for transferable PCM blocks. Bound every queue,
   pending result, and outstanding buffer. The worklet consumes shared Rust
   rendering/gain code and reports generation/consumption. Late results release
   resources; temporary empty feed is Pending and outputs silence without EOF.
4. Wire user activation, AudioContext suspension/resume, actual errors, transport
   controls, and position. Main document displays state and dispatches commands;
   it does not forward PCM through UI state or advance media time with a timer.
5. Test tab/background/screen-off output early on desktop Chromium and Android
   Chrome when a physical device is available. Prototype adapter Media Session
   anchoring if needed; document controls separately from audio continuity.
   If sustained output fails, resolve adapter scheduling before feature growth.

**Close with:** actual browser File reference decode/output over the long input;
matching native audible frame/timeline results within stated tolerances;
responsive seek/cancel during long scans; starvation recovers; no stale seek
audio; bounded memory during delayed output; output independent of UI update
rate. A WASM compile, Node protocol test, or silent statistics page is insufficient.
Installed/offline behavior is added in M2, not claimed here.

## M1: useful file players, modules, and both crude UIs

Status: **verified for Windows x64 native and headless Chromium** (2026-10-19).
The [2026-10-23 validation pass](implementation-log.md#2026-10-23-m1-validation-and-cleanup)
adds Android 16 emulator Chrome, high-rate/unknown-duration inputs, and regression fixes.
Both crudes, the CLI, declared synthetic ordinary/module inputs, independent
jobs and optional single-link WebCodecs Opus are covered. Native GUI checks
include a hidden eframe window with muted real CPAL output. Linux, physical
Android and new-format hardware listening are not inferred; R4's physical and
background checks remain pending independently. See the [M1 evidence](implementation-log.md#m1-file-players-modules-and-both-crudes).

**Deliverable:** the CLI, minimal native GUI, and browser page play supported
ordinary audio and tracker formats through public operations.

1. Add a Symphonia provider for WAV/MP3/FLAC/Vorbis with only required features.
   Keep reference Opus. Share classification/probe selection; verify unknown
   extensions only under the dedicated setting and without constructing output.
2. Adapt existing OpenMPT/Hively instances to R2 jobs/options. Build native and
   browser providers from pinned sources. Keep per-instance Hively state, safe
   immutable initialization, cancellable stepped duration/seek. Expose subsongs,
   interpolation/ramping, speed/pitch capabilities, loop limits, channel mutes,
   module metadata and bounded pattern observations. Inspect without playback.
3. Acquire/generate provenance-backed audible AHX/HVL and XM/S3M/IT/MO3 inputs.
   Translate useful MOD/silent-Hively tests but distinguish lifecycle from sound.
   Exercise two simultaneous contexts and playback plus a separate probe/render.
4. Add eframe/egui crude-native: open, transport, seek/volume/mute, source/provider
   facts, module controls and errors. Add those operations to the PWA. Both use
   the public API without family switches or imported old stores.
5. Only now add an optional WebCodecs audio provider for proved configurations.
   Use shared packet/container/timeline policy; compare trim/gain/seek/EOF against
   reference output. Capability failure leaves the reference path working.

**Close with:** declared formats open/play/seek/EOF on native/browser, both crudes
exercise module settings and independent jobs, source access loss is typed, and
fixtures establish audible behavior. Unsupported cases remain named rather than
being counted as a passed format. No database is necessary yet.

## M2: persistent queue and an installed offline PWA

Status: **implemented; physical lifecycle checks pending** (2026-10-23).
Windows native/SQLite, real browser SQLite/OPFS, two-window ownership/re-election,
capability crash recovery, installed Chromium cold offline launch and controlled
updates have automated evidence. External picker grant/denial, actual hidden-tab/
screen-off continuity, OS media actions and physical Android remain unverified.
Headless and headed minimization still reported `visible`; neither is counted as
a hidden-document pass. See [M2 evidence](implementation-log.md#2026-10-23-m2-persistent-queue-and-installed-pwa).

**Deliverable:** both crudes reopen the same kind of durable queue/settings state;
the installed PWA launches offline, restores access references, and has one owner.

1. Implement a transient session queue with occurrence IDs: append duplicates,
   remove/move, play occurrence, next/previous, previous-restart threshold,
   shuffle/repeat/up-next. Use existing navigation test outcomes. Core chooses
   the next occurrence; crudes render the snapshot.
2. Prove one setting committed/reopened by shared Rust SQL using native SQLite
   and real browser SQLite/OPFS before adding the full schema. Core owns SQL,
   validation, transaction, revision publication. Check init/schema/quota/busy
   errors preserve data and publish no successful durable event.
3. Add source references, sessions/options, ordered queue occurrences, and domain
   settings rows. Queue source references need no Library membership. Restore
   paused without autoplay or permission prompts. CLI defaults to transient;
   add explicit `--profile`. Use only fresh namespaces.
4. Implement genuine FSA pickers/IDB registry, pending/SQL-commit/completion and
   orphan recovery. Plain File inputs remain labeled non-restorable. Restore
   queries permission; a user command obtains grants and retries.
5. Lock the profile before storage/output ownership. Attach a second browser
   window by messages; revisioned snapshot on reconnect, bounded/deduplicated
   requests/results. Owner loss is visible; re-election reopens paused state.
6. Add independent manifest/SW/cache/asset identity to the existing PWA consumer.
   Precache all actual emitted core/audio/provider/SQL loaders and assets; verify
   sizes/local availability. Keep a running runtime on one coherent asset/API
   version and offer controlled update/restart. Wire Media Session actions and
   verify installed background/screen-off/interruption behavior on real targets.

**Close with:** duplicates/order/settings survive native/OPFS reopen; denied
access preserves state/grants; two windows create one player/SQL owner; owner
loss/reconnect works; installed cold offline launch plays local files; update
and physical-device lifecycle observations are recorded independently.

## M3: library, user facts, metadata, artwork, and images

**Deliverable:** both crudes build/reopen a useful media library with working
facts, scans, details, lyrics/patterns, artwork, and independent image navigation.

1. Add core catalog modules and SQL entities: media identity/source revision,
   Library membership, per-media/subsong Favorites, ratings, bookmarks, managed
   roots and scan ownership. Keep ordered queue occurrences separate. Deduplicate
   by source identity under platform case rules; equal bytes at different paths
   do not silently merge. Maintain one canonical display path.
2. Implement paged/indexed sort/filter/group queries. Add/remove/query commands
   and committed events update every membership view. Half-star ratings and
   bookmarks follow identity/subsong/time rather than copied row snapshots.
3. Implement bounded root enumeration/probing and reconciliation jobs. Preserve
   stable IDs/user facts; reconcile only a successfully scanned root's records.
   Partial/cancelled/denied/unavailable scans cannot erase that root. Startup
   queries grants without prompting. Add scan recursion/launch/concurrency and
   unknown-extension verification settings.
4. Normalize metadata fields/precedence from provider/container information and
   bounded supplemental MP3/FLAC/Ogg readers. Add ReplayGain/R128 policy, plain/LRC
   parsing and timeline lookup, module/subsong labels and transient pattern data.
   Embedded lyrics/artwork remain on-demand; never persist pattern snapshots.
5. Accrue Library-only play counts/last-played from the R2 audible timeline after
   the configured continuous threshold. Define seek/pause/repeat resets with
   existing play-count scenarios; no component lifetime determines counting.
6. Extract artwork and implement image providers with dimensions/orientation/color
   facts, revision-keyed rendition jobs and bounded separate cache/eviction.
   Implement an image session capturing its originating query/navigation sequence.
   Viewing/navigating images does not alter music transport. Generic decoding/
   resizing belongs to core/providers; backdrop palette/layout stays in shells.
7. Extend both crudes with Library/Favorites, roots/rescan/cancel, rating/bookmark,
   count threshold, details/lyrics/patterns, artwork and plain image viewer controls.

**Close with:** scan/update/access-loss cases preserve correct identities/facts,
queries work on a larger corpus during playback, metadata inspection opens no
output, caches stay bounded/rebuildable, and images navigate while audio plays.

## M4: Raf, contextual loadouts, and prepared playback

**Deliverable:** both crudes edit/persist real Raf racks/loadouts and exercise
measured gapless/transition behavior using shared native/WASM audio processing.

1. Add descriptor-driven DSP nodes/rack lifecycle: normalized settings, parameter
   changes, bypass, dry/wet, latency/tails, prepare/reset/dispose. Implement the
   eight types in the current registry: Graphic EQ, Auto Amp, Stereo Width,
   Crystalizer, Sloptimizer, Reverb, Pitch, and Heat. Maximization/ceiling is a
   useful processing role, not a ninth existing effect type.
2. Implement the DSP roles using these starting algorithms/controls; revise a
   choice with signal/cost evidence while retaining its useful role:
   Graphic EQ uses cascaded biquads with preamp/band gains; Auto Amp uses a bounded
   peak-envelope gain controller with reduce/increase/dynamic/manual modes and
   target/boost/reduction/hold/recovery controls; Stereo Width uses mid/side gain;
   Crystalizer uses crossover bands with transient/residual enhancement and band
   intensity/mute; Sloptimizer uses multiband upward/downward compression, lift,
   crossovers, and ceiling; Reverb uses a feedback-delay network with mix/decay/
   predelay/damping; Pitch starts with a phase vocoder with semitone/quality
   control; Heat uses bounded waveshaping with drive/color/output. Shared renderer
   executes them on native/worklet and processed render jobs. Prepare topology
   changes off output, smooth parameters, preserve pre-Raf ReplayGain and
   post-Raf master, video Auto Amp bypass, and pre/post-Raf analysis taps.
3. Add SQL presets and playback/Raf loadout bundles. Core implements file/folder/
   kind/tag matching, priority, override and baseline restore using bounded Rust
   regex. Publish matched identity/effective values/reasons; shells associate
   appearance payloads without reimplementing matching. No old preset conversion.
4. Add session preparation using independent current/prepared/outgoing instances,
   output block budgets, and effective settings. Resolve next occurrence,
   prefill, join audible ranges after trim/resampling/drain, invalidate on queue/
   source/loadout/seek changes. Then implement fades/crossfades and failure policy.
5. Both crudes get rack ordering/parameters/meters, preset/loadout editing,
   effective settings, preparation diagnostics, gapless/transition settings and
   actions that provoke rapid changes. Closing an editor changes no behavior.

**Close with:** signal-property and stability tests per effect; measured worst
case cost/latency; matching/restore/reopen scenarios; sample-level joins across
providers/rates and duplicate occurrences; no stale prepared source under rapid
edits. List gapless limitations by provider. Old waveforms are not the golden.

## M5: video transport and plain viewports

**Deliverable:** PWA video decodes with browser codecs and synchronizes to the
shared audible clock; native viewport works through an optional linked provider.

1. Implement core demux/timestamp/seek-preroll policy for WebM/Matroska Opus/VP8,
   then MP4 H.264/AAC. Choose maintained container readers; expose stream configs,
   codec data, keyframe/decode order, delay/discard and seek plans. Keep timeline
   math shared with audio. No browser software-video bundle.
2. Add WebCodecs worker provider with actual configuration probes, asynchronous
   outcomes and opaque VideoFrame leases. Core owns frame budgets, generations,
   retention/drop deadlines and recovery. Adapter holds/releases platform frames.
   Verify bounded decode/seek before attaching a viewport.
3. Add optional feature-gated linked native FFmpeg provider, then one native
   surface and one browser canvas/surface. Map timestamps to R2 audible output
   plus Raf/output latency; silent video uses core monotonic timing. Surface
   handoff changes presentation, never session/source ownership.
4. Suspend unnecessary hidden video work while audio continues; reopen/seek/preroll
   to the live timeline on return. Handle decoder reclamation/loss and release
   stale frames. Both crudes expose stream selection, viewport, seek, timing,
   frame/drop/resource stats, and surface switch controls.

**Close with:** visible A/V sync, repeated seeks and DSP-latency changes, silent
video, orientation/color, hidden recovery and exclusive surface handoff. Measure
resources/efficiency on representative clips and repeat installed/background
checks. Unsupported codec configurations fail visibly.

## M6: independent embedding and adoption readiness

**Deliverable:** an actual C caller uses libzci without a device or UI, and all
required core behavior is demonstrated by native/browser consumers.

1. Implement `libzci-ffi`: opaque runtime/session/job handles, API version,
   explicit buffer ownership, bounded events, typed errors, panic/exception
   containment and shutdown. A tiny C executable opens/renders/seeks/closes two
   sessions, cancels a job, and frees everything through the public ABI.
2. Close the [readiness matrix](validation.md#adoption-readiness). Audit crudes
   for SQL/transport/shuffle/count/loadout/DSP logic that belongs in core. Exercise
   independent sessions, no-device operation, playback+probe+render, prepared/
   outgoing overlap, access/database/device failures and restart.
3. Reproduce target recipes and record formats/providers, limits, API/build
   versions, Windows/Linux status, installed-PWA/physical Android evidence, and
   measured resource budgets. Resolve required pending checks before adoption.

**Close with:** consumers need no corrective domain logic, the foreign caller
works, native remains JS independent, and browser audio/video/storage/offline
requirements have real evidence. Readiness is finite required behavior, not an
unbounded polish target or permission to skip hard browser requirements.

## A1: replace izci-server's overlapping engine

After M6, write a focused adoption plan against the actual ABI and job API.
Replace decoding, catalog/queue/facts, session/timeline, and device-free rendering
at `internal/media` and host session/storage seams. Specify handle/thread/job
ownership and shutdown; keep Go signaling/admission/pairing/permissions/Pion and
delivery orchestration. Prove shared playback and independent Freeplay, bounded
render/cache invalidation, source-file/buffered Opus-WebM delivery, and
listener-owned processing. Preserve sensitive-data handling and protocol fixtures.
Format Go and run required vet/race tests after server changes. No old-state
migration. A detailed integration design depends on the proven core API.

## A2: adopt the core in existing Svelte shells

After A1, write the browser/desktop/Android ownership-slice plan using real APIs.
Replace each service/store authority completely; stores become observation/
binding facades and components render/dispatch. Account for real FSA/native/SAF
access, separate windows/settings, offline/install/update and listener DSP.
Desktop/mobile/Oda remain presentations of the same runtime. Use fresh libzci
state without dual writes or old-state conversion. Tools/tag writing are separate
later plans. Detailed shell migration is not work to begin during recovery.
