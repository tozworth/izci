# libzci implementation plan

Build a reusable izci engine in Rust, with compiled media libraries where useful.
Native consumers must work without a JavaScript runtime, browser, or webview.
The browser build uses WebAssembly and browser adapters and remains an offline PWA.

Development proceeds through working consumers:

```text
zci-play
    -> crude native UI + crude PWA
    -> independently useful core with library, user state, Raf, and video
    -> replace izci-server's player/catalog/rendering engine
    -> existing Svelte shells consume the mature core piecemeal
```

The crudes drive core development by reproducing useful izci functionality through
its public API. Existing Svelte integration starts after this work has made the
core good enough; it does not dictate the early implementation order.

## Where to start

**Read [Initial scaffolding](scaffolding.md) first.** It describes what exists in
this checkout, the proposed packages, and how native and browser builds fit
together. Then read [Ownership boundaries](boundaries.md) before creating code.

**Execute [phases.md](phases.md) from Phase 0.** Phase 0 creates the initial
workspace and records build inputs. It requires no running libzci, database, or
profile. Phase 1 implements source access and reference Opus decoding; Phase 2
makes `zci-play` audible. The PWA begins as a small browser consumer during those
steps and grows beside the native crude in Phase 3.

Each subphase names:

- Current repository files to inspect for behavior or reusable source.
- New modules to create and operations to implement.
- What the CLI or crude must do through that API.
- Checks that distinguish a completed implementation from a stub.

A completion check is simply a condition to verify before moving on. For example,
Phase 2 is complete when the CLI actually plays the declared formats to EOF,
seeks correctly, and shuts down cleanly; successful compilation alone is
insufficient. Implementation and verification have separate statuses if builds
or device access are unavailable.

**Current status:** only these planning documents exist. There is no `libzci/`
workspace, engine binary, browser engine build, or libzci profile. All roadmap
steps are unstarted. Paths beneath `libzci/` in this plan are files to create,
not commands or APIs already available in the checkout.

## Supporting documents

| Document | Use it for |
| --- | --- |
| [Scaffolding](scaffolding.md) | Checkout baseline, package/module placement, initial dependency and browser wiring choices |
| [Boundaries](boundaries.md) | Deciding whether behavior belongs in core, adapter, or presentation |
| [Phases](phases.md) | The implementation task sequence and concrete completion checks |
| [Contracts](contracts.md) | API invariants to preserve as each task adds operations |
| [Crudes](crudes.md) | Which controls exercise which core operations; browser installation and lifecycle checks |
| [Validation](validation.md) | Fixtures, signal properties, resource measurements, and readiness for adoption |
| [Codebase reference](reference.md) | Links to current implementations, existing tests, provenance, and upstream documentation |

Read contract sections when their subphase needs them. Do not implement every
future type or interface before the first decoder works. The proposed names in
the plan establish responsibilities; adjust a signature when exercised code
requires it, and update its callers and documentation together.

## Decisions already made

- Providers are registered at startup and open independent instances per
  track/job. There is no initial runtime plugin loader or mid-track replacement.
  Preload/gapless must support simultaneous current, prepared, and outgoing decoders.
- Working Opus is mandatory from the first useful player. Start with reference
  libopus/libopusfile rather than gambling the library on an unfinished decoder.
- SQLite holds durable domain state on native and browser targets. Browser FSA
  handles use a small separate IndexedDB capability registry; SQL holds IDs.
- Artwork and images are fundamental. Tag writing, Troubadour, conversion, and
  other workbenches are deferred and need separate ownership decisions.
- Raf retains useful effect roles and controls. Exact old sound, algorithms,
  defaults, or serialized settings are not compatibility requirements.
- Browser video uses browser codecs and rendering surfaces coordinated by core
  transport/timing. No software video codecs in PWA assets. Native builds may
  register an optional FFmpeg provider.
- No pre-libzci import, migration, legacy readers, preset conversion, or
  cross-generation backup/restore path. New state is created when storage lands.
- Desktop/mobile/Oda shells, themes, visualizers, and backdrop presentation
  remain outside libzci.

## Execution rules

Follow [AGENTS.md](../../AGENTS.md). Writing this plan authorizes no builds,
fixture generation requiring additional toolchains, development servers, or
browser inspection. When executing it, obtain the explicit build/runtime
authorization required by that guide unless an authorized debugging session
already covers the checks. Record a pending check plainly instead of claiming
a pass or dropping the requirement.

Start an implementation log in Phase 0 as specified in the roadmap. Commit
coherent implemented subphases and their meaningful checks. Keep generated
outputs in the new workspace or ignored `.local/libzci/` locations. Preserve
unrelated changes, the existing app's state, and its filesystem grants.

Current backend/storage instructions continue to apply to the old runtime.
The new isolated runtime follows the user-approved libzci boundaries instead.
Do not edit existing frontend/server runtime owners until the adoption phases.
Update AGENTS.md concisely when implemented ownership actually changes.

The scaffold specifies defaults so an agent can start. Only the native/WASM
linking, synchronous codec I/O, SQLite bridge, and audio-buffer transport need
early experiments. Those experiments have named inputs and checks in Phase 1;
record a replacement choice with its evidence if a default fails. PWA support
and native independence from JavaScript remain requirements.

Server and Svelte adoption are deliberately outlined at the end of the roadmap.
Their detailed implementation plans should use the working core API, written
after the crudes have established it.
