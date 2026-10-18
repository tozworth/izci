# Verification

[Overview](README.md) · [Roadmap](phases.md) · [Review](review.md)

Pure tests, builds, devices, browser pages, and installed PWAs prove different
things. Follow AGENTS.md for authorization. Current R1/R2 and Windows R3 results are recorded in the
[implementation log](implementation-log.md); the original phase reports remain historical.

## Recovery checks

| Milestone | Concrete check | Failure it detects |
| --- | --- | --- |
| R1 | Long numbered/marked source through tiny variable-capacity sink; compare samples/tail | Unwritten frames or converter output discarded |
| R1 | Concurrent producer/consumer, generation change during pop, blocked-capacity teardown | Unsound mutation, producer cursor reset, stuck shutdown |
| R2 | Pause/seek/stop solely through session commands | Separate output control is required for transport |
| R2 | Hold decode open; seek/stop/dispose and operate second session | Global locks or decoder work block commands |
| R2 | Pending, then data, EOF, final consumption | Starvation becomes EOF or Ended comes early |
| R2 | Underrun, seek to marker, pause/suspend/resume | Silence/read-ahead/wall time becomes media position |
| R2 | Interrupt open/seek/streaming render | Disconnected cancellation or file-sized memory growth |
| R3 | Long real Opus plus reference render/frame accounting | Short smoke hides drops, trim or gain errors |
| R4 | Play real File with AudioDecoder disabled | Optional platform decode substitutes for reference path |
| R4 | Cancel long scan, seek pending decode, throttle output | Unresponsive worker or unbounded queues |

Use deterministic sink/job schedules for ordering/budgets and real providers
for media/output behavior. Sleep-based unit tests or a steady sine's peak/RMS
do not establish sample continuity.

## Media, DSP, and timing

Use the [corpus](../../fixtures/README.md) and exact generation pins/digests.
Distinguish recipes from available bytes. Add long marked signals, channel/rate
variants, Opus gain/trim/chained/corrupt/seek cases, and licensed audible modules.
Blank AHX/HVL proves lifecycle only. Private-library listening is local evidence,
not redistributable fixtures. Keep generated media ignored.

Record sample counts, target/landed seek, decode/queue/output ranges, applied
trim/gain, and drain. Native/browser semantics and shared kernels use justified
tolerances; old JS/storage/browser-node output is not the golden.

DSP inputs include sweeps/tones/impulses/silence/transients/stereo. Check response,
gain bounds/recovery/ceiling, width/pitch, mix/bypass, smoothing, latency/reset/
tails, topology edits, finite output, rates/block sizes. Measure processing cost,
queue/memory high-water marks, allocations/blocking, underruns and worst-case rack
cost on declared hardware; establish budgets from evidence.

Video checks cover seek/preroll, visible A/V sync/DSP latency, silent video,
orientation/color, exclusive surface handoff, hidden-video/audio continuity,
decoder reclamation, bounded leases, and cleanup. WebCodecs availability does
not prove configuration support, acceleration, efficiency, or background survival.

## Persistence and installed behavior

Test real native SQLite and browser OPFS through shared SQL: commit/reopen,
failed writes, busy/quota/schema/init failure, owner loss, and registry/SQL crash
boundaries. Failures preserve data and publish no committed success. Scans
preserve facts on cancellation/access loss and reconcile only their own root.
Counts/loadouts/navigation do not depend on UI lifetime. Attach/reconnect clients
to one profile/session owner.

Offline cold launch includes every emitted loader/WASM/worklet/provider/SQL
asset; verify coherent updates. Record tab and installed PWA separately on
desktop Chromium and physical Android Chrome: activation, transport, background/
screen-off, lockscreen actions, interruption, return/recovery. Emulator or
foreground success does not close physical-device checks. APK/SAF integration
is a separate later adapter task.

## Adoption readiness

Before A1 and then A2, required evidence is:

| Area | Required result |
| --- | --- |
| Embedding | Native CLI/crude and C caller without JS/webview/WASM runtime; two sessions/device-free jobs |
| Transport | Lossless bounded long output, audible clock, pending/drain, responsive cancel, prepared/outgoing overlap |
| Formats | Reference Opus and declared regular/module families with audible seek/EOF/isolation on both targets |
| Domain | Queue/catalog/facts/roots/scans/metadata/lyrics/patterns/artwork/images/settings through public API |
| DSP | Useful eight-effect inventory, loadouts/presets, shared native/worklet/render code, measured properties/cost |
| Video | Browser codecs, native declared support, shared timing, bounded frames/recovery |
| Storage | Shared SQL, native/OPFS reopen/failure, real capability registry, single ownership/reconnect |
| PWA | Installed offline/update and physical-device background/OS control evidence |
| Portability | Reproducible target-aware recipes, required Windows/Linux gaps resolved |
| Ownership | No second domain/DSP engine, direct domain SQL, or corrective media policy in crudes/bindings |

This is a finite acceptance target. Optional capabilities stay separate. Missing
required checks stay open unless the user changes scope.

## Recording evidence

Append milestone, commit/API identity, command/interaction, toolchain, target/
device/browser, input, result, measurements and limits to the log. Use `open`,
`implemented; checks pending`, or `verified`. Distinguish unsupported, failed,
not-run and passed. Profile is `none` before M2. Historical Phase labels stay
historical. Avoid sensitive file contents, tokens, SDP and signaling data.
