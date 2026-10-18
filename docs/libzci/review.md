# Review of the first libzci attempt

Reviewed on 2026-10-18 at `168874dd` (`origin/libzci-muse`). This is a source
review, not a new build, test run, listening session, or browser inspection.
The previous agent's results in [implementation-log.md](implementation-log.md)
are historical reports and have not been independently reproduced here.

## Decision

Keep the branch as recoverable work. Reuse the source access, provider wrappers,
fixture recipes, and useful tests after checking them. Rework the session/output
integration before extending the engine. There is enough actual implementation
to make deleting everything wasteful; there is not enough evidence to treat the
reported Phase 2.2 position as a dependable starting point for Phase 2.3.

The replacement [roadmap](phases.md) starts with recovery and then proceeds
through working applications. No implementation is removed by this review.

## What the plan failed to settle

The latest saved plan does contain implementation steps. Its weakness is more
specific than an absence of detail: it names modules and states, but leaves the
execution model between them to the implementer. It does not settle how a
command interrupts decode, how a producer waits for output capacity, how output
acknowledges a seek, or how provider progress becomes audible media position.
Those omissions sit on the critical path of almost every promised feature.

Before its first audible CLI, it also schedules generalized commands/events,
native and browser provider wiring, both tracker families, and their acquisition
recipes. That makes a wide foundation the first deliverable. Browser reference
decode, worker responsiveness, and actual output remain unproved while the
implementation expands around them. File lists and numerous checks did not
give the agent a small, fully specified playback loop to implement first.

## Source findings that determine recovery order

### 1. Native output can discard most of a long track

In [playback.rs](../../libzci/crates/libzci-native/src/playback.rs),
`pipeline_main` decodes continuously and calls `ring.push` without retaining the
unaccepted suffix. [PcmRing::push](../../libzci/crates/libzci/src/audio/buffer.rs)
returns a short count when its roughly two-second buffer fills. The producer
therefore advances the decoder while dropping audio. The resampler flush also
ignores that count. A quarter-second fixture does not exercise this case.

Recovery must preserve pending samples and use output capacity to schedule
further decode. Verify a long, marked signal against a deliberately slow sink,
including a full ring, before calling the CLI usable.

### 2. The ring's safe API does not enforce its safety assumptions

`PcmRing::push(&self)` casts a pointer from `Vec::as_ptr()` to mutable storage.
There is no interior-mutability representation, and any caller can invoke two
producers through shared references. `clear()` writes the consumer's read index
from the producer side while `pop()` can still be using it. Atomic indices do
not establish unique ownership of the sample storage or make reset safe.
See Rust's [interior-mutability rules](https://doc.rust-lang.org/std/cell/struct.UnsafeCell.html).

Replace this transport with an established bounded queue exposing distinct
producer and consumer handles. Flush through a consumer-acknowledged generation
change; the producer must never rewrite a live consumer cursor.

### 3. There are separate transport controls without one authority

`Session::decode_for_generation` decodes independently of requested play state.
The native pipeline watches a separate output pause flag. A session `Pause` is
not the output pause operation. The runtime holds the global sessions map lock
during synchronous open/seek/decode, so a long job also obstructs unrelated
sessions. `decode_session_chunk` discards the generation returned with PCM;
checking a generation separately before decode leaves a seek race afterward.

Recovery needs one session command owner, decoder jobs outside that owner,
generation-tagged completion/buffers, and an output acknowledgment boundary.
Native and browser execution should drive this same state machine.

### 4. Reported position and output state are not authoritative

`output_state` always constructs `RunningState::Running`, even after
`pause_output`. The device callback increments consumed frames for underrun
silence as well as media. Session position advances on decode, not audible
consumption. The standalone `OutputClock` is not the session/output integration
and its test explicitly allows position to jump when changing to suspended.

Track device progress separately from the media ranges actually submitted and
consumed. A seek creates a new mapping. Suspension freezes the last audible
media position; errors arrive as state changes, rather than only stderr text.

### 5. The browser proof changes the critical provider and misses EOF semantics

The [decode worker](../../libzci/consumers/crude-pwa/src/workers/decode-worker.ts)
uses `AudioDecoder`; the planned Emscripten reference Opus build is absent.
The missing toolchain is recorded, but this alternative does not prove the
required reference path. Native Opus seek logic and browser `plan_opus_seek`
have separate implementations. The worker's `scanIndex` has no yield inside
its loop, so a posted cancel/release cannot interrupt a long index scan.

In [engine.rs](../../libzci/crates/libzci-web/src/engine.rs),
`HostDecoder::decode_into` returns zero when its feed queue is temporarily empty;
the core decoder contract treats zero as EOF. `Session::decode_for_generation`
then marks a playing session ended. An asynchronous provider needs distinct
pending, data, EOF, and failure outcomes.

Prove reference Opus decode and audible worklet output before broadening browser
coverage. Keep WebCodecs audio as an optional provider after that baseline works.

### 6. The public API is already insufficient for the first consumer

The CLI's `open_with_subsong` sniffs module families, constructs concrete
OpenMPT/Hively instances, selects a subsong, and loads the instance. The log
describes parsing as command translation, but the source puts media policy in
the consumer. Its render path also collects the entire result with
`render_to_vec(..., u64::MAX)` before writing a file; Ctrl-C sets a separate flag
that does not cancel that render while it runs.

Add provider-neutral load/module options and incremental render jobs to the
public API. The CLI should use those same operations as every other consumer.

## What to keep provisionally

- Independent workspace and separation from the existing player.
- Bounded native file reads, typed errors, IDs, PCM validation, and format hints.
- Native OpenMPT and Hively wrappers, especially per-instance Hively contexts
  and stepped probe/seek operations. Audible and concurrent coverage still needs
  work; cancellation must be connected to an actual scheduler.
- Dependency pins, acquisition recipes, MOD helpers, synthetic Opus recipe,
  and provider tests as inputs for reproducible recovery.
- Signal-processing code where new tests demonstrate its intended behavior.

Keep the custom Ogg/Opus work available as a reference while establishing the
planned libopusfile baseline. A binding-crate concern alone does not prove that
the C callback route failed. Retain one shared implementation for any custom
timeline/container policy that remains; native and browser adapters must not
each grow their own version.

## Verification limits and next action

The recipes and linkage currently target GNU/Linux (`.a`, GNU tools, `stdc++`).
That is a useful initial target, not demonstrated Windows support. Browser
execution and Emscripten providers are explicitly pending in the historical log.
Short-device-smoke and sequential ring tests do not cover the findings above.

Next: implement milestone R1 from the replacement roadmap, starting with a
bounded, lossless device-free pipeline. Builds/runtime checks remain subject to
the repository's explicit authorization rule. This review authorizes no runtime
change and reports no new test passes.
