# Verification

[Overview](README.md) · [Roadmap](phases.md) · [Review](review.md)

Pure tests, builds, devices, browser pages, and installed PWAs prove different
things. Follow AGENTS.md for authorization. Current R1/R2, Windows R3, and R4
headless results (with physical/background limits) are recorded in the
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

DSP sweeps/impulse/property checks, effect-by-effect stability, allocation
measurements and worst-case rack cost are post-MVP M4 backlog. Full core-video
checks are post-MVP M5 backlog. During MVP, preserve the existing browser
`<video>` path and require basic real-file playback, seek, pause, EOF and error
behavior. WebCodecs availability does not prove configuration support,
acceleration, efficiency, or background survival.

## Persistence and installed behavior

Test real native SQLite and browser OPFS through shared SQL: commit/reopen,
failed writes, busy/quota/schema/init failure, owner loss, and registry/SQL crash
boundaries. Failures preserve data and publish no committed success. Scans
preserve facts on cancellation/access loss and reconcile only their own root.
Counts/navigation do not depend on UI lifetime. Attach/reconnect clients
to one profile/session owner.

Offline cold launch includes every emitted loader/WASM/worklet/provider/SQL
asset; verify coherent updates. MVP requires desktop Chromium tab and installed
PWA checks with real local files. Physical Android/background/screen-off,
lockscreen actions and APK/SAF integration are post-MVP evidence rather than
adoption gates.

## MVP Svelte-adoption gate

Before calling A2 complete, required evidence is:

| Area | Required result |
| --- | --- |
| Playback | Ordinary stream formats and tracker modules open/play/pause/seek/EOF through the public API in native/browser targets used by izci |
| Formats | MP3, WAV, FLAC, OGG/Vorbis, Opus, OpenMPT modules and AHX/HVL work with real files; unsupported cases are named, not guessed |
| Video compatibility | The existing browser `<video>` playback path still works in the Svelte shell; core video migration is not required |
| Domain | Queue, library, favorites/ratings, managed scans, metadata, lyrics, artwork/images, settings and play counts go through shared core rather than migrated Svelte stores |
| Storage/access | Native SQLite and browser OPFS reopen correctly; real File/FSA/native access and one profile owner are preserved |
| Browser/PWA | Typecheck/build, installed/offline launch and real local playback pass; headless checks are acceptable for MVP |
| Ownership | Migrated Svelte stores are observation/binding facades; no second queue/library/transport implementation remains for adopted slices |
| Compatibility bridges | Any temporary video or Raf bridge is explicit, isolated and outside the migrated domain authority |

Not required for MVP: AVIF, HDR/non-ICC color, strict codec heap accounting,
full Raf effect parity/loadouts/gapless transitions, core WebCodecs/FFmpeg video,
C ABI/foreign caller proof, izci-server adoption before the shells, physical
Android/background, GNU/Linux targets, disk-exhaustion tests or exhaustive
performance conformance. These are post-MVP backlog and do not block adoption.

## Recording evidence

Append milestone, commit/API identity, command/interaction, toolchain, target/
device/browser, input, result, measurements and limits to the log. Use `open`,
`implemented; checks pending`, or `verified`. Distinguish unsupported, failed,
not-run and passed. Profile is `none` before M2. Historical Phase labels stay
historical. Avoid sensitive file contents, tokens, SDP and signaling data.
