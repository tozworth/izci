# Thermonuclear code review and general quality/efficiency pass

This document defines the **nukepass**: a long-horizon, staged review and near-reconstruction of izci. It is intentionally more ambitious than deleting unused packages, renaming helpers, or splitting large files until the line counts look respectable. The point is to re-establish explicit ownership, deterministic state transitions, bounded resource use, and browser-verifiable behavior across the whole application while retaining the product that already exists.

## Decision

Treat the current application as the behavioral specification and most of the current implementation as replaceable.

Preserve the recognizable izci experience, its local-first/offline model, its playback reach, its dense desktop interaction model, its separate mobile shell, its tool windows, and its deliberately specific Goldilocks controls. Replace incidental internal APIs, duplicated state, callback choreography, hand-built lifetime management, overgrown composition roots, and compatibility scaffolding with a clean current-version architecture.

This is not a feature freeze in the ordinary sense. The Multiplayer experiment is moving quickly and may continue to do so until a nukepass execution checkpoint is declared. At that checkpoint, its desired behavior and wire contract are captured once, its protocol is allowed a clean incompatible bump, and the reconstructed implementation becomes the only implementation. There is no adapter ladder between experimental protocol generations.

The central bargain is:

- functionality may be temporarily unavailable only inside a development branch or an explicitly isolated cutover slice;
- accepted checkpoints must remain usable as the single-user daily-driver application;
- UX concepts and settings survive unless an explicit product decision says otherwise;
- obsolete implementation paths do not survive a completed cutover merely to reduce short-term risk;
- performance claims require measurements, and correctness claims require tests plus browser evidence;
- the final result is not accepted until a clean production build passes the complete CDP verification matrix and the remaining installed-PWA/device-only checks are signed off separately.

## Why a nukepass is warranted

The codebase already contains good ownership boundaries, substantial unit coverage, and unusually careful browser behavior. It has also reached the point where local improvements can disguise system-level risk.

The 2026-08-12 tree has roughly 96,000 non-vendor source lines across about 367 TypeScript and 97 Svelte files, with 138 test files. Several files are not merely large; they sit at the intersection of too many ownership domains:

- `App.svelte` is about 2,485 lines and imports roughly 72 internal modules. It is simultaneously a composition root, local/remote collection projector, Multiplayer adapter, selection reconciler, playback presenter, artwork/lyrics/pattern mediator, window/PWA integration point, and desktop/mobile switch.
- `src/lib/types.ts` is a roughly 632-line common type bucket imported across much of the application. It joins media, playback, DSP, persistence-facing settings, workspace, menus, collections, and window concepts that should not all change together.
- `player-controller.ts` manages multiple backend bundles and transitions while four backend families expose similar behavior through callback-shaped, non-uniform contracts.
- Collection state spans hydration, persistence scheduling, deduplication, selection, navigation, metadata work, materialization, and object URL ownership.
- Browser resources are acquired and released through many unrelated local patterns: workers, worklets, timers, animation frames, object URLs, media elements, audio nodes, peer connections, data channels, BroadcastChannels, IndexedDB connections, service workers, and popup windows.
- Multiplayer now comprises signaling, protocol validation, peer/ICE lifecycle, hosted authority, Freeplay authority, source transfer, buffered Opus rendering, scheduling, memory and disk caches, MSE playback, receiver monitoring, and recovery. Its host and client controllers are about 1,704 and 1,452 lines respectively. This is an actor system hiding in closures, not experiment glue awaiting one more file split.
- Tool roots repeat lifecycle, job, drag/drop, menu, popup, theme, logging, worker, object URL, and keyboard concerns while also owning rich domain behavior.
- Vite has eight explicit page inputs, a matching navigation-fallback denylist, production-only PWA behavior, and special Chiptune/libopenmpt worklet emission. These declarations can drift independently.

None of those observations proves that a file is bad because it is long. They show where responsibility analysis, characterization, and contract replacement must begin. A successful nukepass reduces the number of reasons each owner has to change; smaller files are a likely consequence, not the score.

## Product constitution

The nukepass may scorch compatibility. It may not scorch the product.

### Behavior that survives

- Streamed/regular audio continues to use Howler in HTML5 audio mode.
- OpenMPT tracker modules continue through Chiptune3/libopenmpt and Web Audio.
- AHX/HVL playback continues through the Hively replayer.
- Video continues through a native video element and enters the shared Web Audio graph when Chromium permits it.
- Playlist and library remain separate collections. The library deduplicates; the playlist does not.
- Playlist/library persistence, reusable directory handles, lightweight settings, artwork cache, and rebuildable Multiplayer render cache remain in their correct, separate storage domains.
- File permission and materialization behavior remains user-driven. Launch scans do not ask for permission.
- Metadata, artwork, lyrics, patterns, ReplayGain, play counts, ratings, favorites, folder scans, launch/file-handler paths, backups, loadouts, Media Session, mini-player, video theater, artwork/visualizer backdrops, and popup tools remain product capabilities.
- The desktop UI remains compact, restrained, keyboard-capable, and desktop-like. Narrow desktop windows remain desktop UI.
- Mobile retains its bespoke shell, navigation order, touch-first list rows, swipe exclusions, and full-page Options presentation.
- Options remains rich. Existing controls are presumed intentional even when obscure.
- Audio Compare, Editor, Converter, Logs, Troubadour, and Troubadour Options remain separate pages with their present product roles.
- Multiplayer retains Co-op, hosted audio, source-file delivery, buffered Opus delivery, video RTP, pairing, reconnect/restore behavior, synchronized playback controls, and Freeplay's independent per-pair timeline.
- izci remains an offline PWA with no application backend. Firebase remains short-lived Multiplayer signaling, not a media/library backend.

### Goldilocks preservation rule

Before implementation, build a setting ledger for every Options and tool-specific control. Each entry records:

| Field | Required record |
| --- | --- |
| Identity | Stable semantic name and owning domain |
| Presentation | Category, label, hint, enabled/disabled conditions, mobile/desktop exposure |
| State | Default, range/choices, normalization, storage key/database, reset behavior |
| Synchronization | Broadcast channel or other cross-window delivery and duplicate suppression |
| Runtime | Exact consumer and when changes take effect |
| Evidence | Unit/contract coverage and CDP scenario |
| Disposition | Preserve, repair, redesign, or explicitly remove by product decision |

No agent may delete a setting because it appears unnecessary, advanced, overlapping, difficult to place in a cleaner model, or lightly used. If a control is currently disconnected, the default action is to restore its runtime connection. Removal requires a separate recorded product decision, its behavioral consequence, and evidence that it is not masking a broken ownership path.

New substantial behavior receives the same review: determine whether it needs a Goldilocks control, whether an existing control already expresses it, and which valid Options category owns it. This does not mean exposing every buffer watermark or internal timeout.

### Compatibility policy

- Do not create legacy persistence migrations unless separately requested. A changed pre-alpha schema gets a new current-version key/database/store and a documented one-time reset consequence.
- Do not retain old service façades, `v1`/`v2` implementations, duplicate stores, protocol adapters, deprecated fields, or shadow write paths after a cutover is accepted.
- Temporary comparison adapters are allowed inside an unmerged slice when they enable differential testing. They are deleted in the same stage that accepts the replacement.
- Multiplayer wire compatibility is explicitly disposable. Protocol source, decoder/validator, binary framing, Firebase rules, and tests move as one checkpoint.
- UX familiarity is not “legacy compatibility.” It is product behavior and remains unless explicitly redesigned.

## Outcomes and non-goals

The intended end state has:

- explicit bounded contexts and import direction;
- small public contracts around browser capabilities and side effects;
- deterministic controllers or actors with named legal transitions;
- one canonical owner for each durable and transient state;
- uniform cancellation and teardown for every acquired browser resource;
- separately testable domain state, browser adapters, and presentation projections;
- a thin application composition root;
- components that render read-only view models and dispatch commands;
- current-version persistence with clear storage boundaries and failure behavior;
- one declared registry for pages, workers/worklets, popup paths, and PWA navigation policy where those facts must agree;
- measured startup, steady-state, large-library, playback, rendering, and Multiplayer budgets;
- a committed CDP harness that can reproduce the browser evidence formerly kept in throwaway rigs.

The nukepass does not aim to:

- make izci generic, server-backed, framework-neutral, or browser-agnostic;
- replace Svelte, Howler, Chiptune3/libopenmpt, Hively, Mediabunny, Firebase signaling, or the native video element merely for novelty;
- support historical schemas or experimental protocol versions;
- merge mobile into responsive desktop CSS;
- turn Options into a simplistic automatically generated form;
- flatten specialist tool windows into the main application;
- replace dense desktop UI with cards, large gutters, prominent links, or touch styling;
- treat line count, dependency count, bundle count, or test count as a goal without behavioral context;
- prove physical audibility, OS file-handler launch, installed Window Controls Overlay, or real network quality using headless CDP alone.

## Program operating model

This project is too interconnected for a crowd of agents editing shared roots concurrently. It is also too large for one agent to review its own assumptions all the way through. The nukepass therefore uses delegated survey, contract, implementation, adversarial review, verification, and integration roles with hard ownership boundaries.

### Command structure

- **Review director:** owns this plan, the behavior constitution, stage gates, risk register, and stop/go decisions. Does not casually resolve implementation questions in favor of speed.
- **Integration conductor:** owns shared contracts, dependency ordering, cutover branches, conflict resolution, and the final deletion ledger. It is the only role allowed to land cross-domain interface changes after a contract freeze.
- **Domain leads:** playback/audio, files/catalog/metadata, persistence/settings, application/workspace, desktop/mobile presentation, tools, build/PWA, and Multiplayer. Each lead owns a bounded context and its acceptance matrix.
- **Survey agents:** read-only investigators. They map behavior, dependencies, state, resources, storage, knobs, failure modes, and tests before code moves.
- **Contract agents:** propose types, ports, events, invariants, state machines, architectural decision records, and characterization suites. They do not implement the contract they are still evaluating.
- **Implementation agents:** own disjoint vertical slices with an agreed input/output contract. They report files changed, invariants established, resources acquired/released, settings preserved, tests added, and unresolved risk.
- **Adversarial reviewers:** do not review their own implementation. They specifically attack race handling, cancellation, storage boundaries, browser fallbacks, error recovery, resource leaks, stale generations, keyboard/mobile behavior, and silent loss of settings.
- **Verification agents:** independently run the applicable unit, type, localization, protocol, build, artifact, and CDP gates. They record commands and artifacts rather than repeating the implementer's claim.
- **Performance agents:** establish baselines, capture traces/heap snapshots, locate causal hot paths, and verify budgets after correctness. They do not perform speculative micro-optimization.
- **Documentation custodian:** keeps architecture decisions, ledgers, matrices, and actual verification results synchronized. It does not turn AGENTS.md into a source index or changelog.

### Parallelism rules

Every wave begins with an ownership ledger. It lists each agent's writable directories/files, shared contracts it consumes, contracts it may propose but not change, test fixtures it owns, and the integration order. Parallel agents use separate branches/worktrees or otherwise isolated edit surfaces. They never concurrently edit `App.svelte`, shared type barrels, protocol contracts, localization catalogs, Vite configuration, or a common generated artifact.

Parallel work is encouraged when contracts are stable:

- backend adapter conformance can proceed separately for Howler, OpenMPT, Hively, and video;
- persistence repositories can proceed separately from settings synchronization after their ports freeze;
- Multiplayer signaling/peer lifecycle, wire protocol/security, render/transfer/cache, Freeplay, and simulation harnesses can proceed under one Multiplayer lead;
- desktop workspace, mobile shell, Options, and tools can proceed against one application view-model contract;
- CDP scenarios can be authored by domain while one harness owner controls launcher/session/report infrastructure.

Parallel work stops when two slices need the same canonical state or browser resource. The integration conductor first decides ownership and freezes the interface. “Both need it” is never accepted as a reason for duplicate state.

### Agent handoff packet

Every implementation/review handoff must answer:

1. What observable behavior was characterized?
2. What contract or invariant changed?
3. Which capabilities and Goldilocks controls were preserved?
4. Which storage keys/databases/channels or wire messages changed?
5. Which browser resources are acquired, and exactly how are they cancelled/disposed?
6. Which error, permission-denial, cancellation, stale-event, and unsupported-browser paths were exercised?
7. Which old path was deleted or remains temporarily, and why?
8. Which focused tests, checks, build, and CDP smoke ran?
9. What should an adversarial reviewer try to break?

### Stage gate rules

- A stage starts with characterization and ends with deletion. It does not end when a replacement compiles beside the old path.
- Every source-changing step follows the repository rule to run `npm run build`. Focused tests and `npm run check` run when relevant. Interface copy follows the localization workflow; `en-askew.json` remains manual.
- `npm run build` runs only after checking whether its prebuild protocol synchronization will intentionally modify Firebase rules. Protocol-sensitive work runs the non-writing protocol check first where appropriate.
- No baseline number is invented. Initial budgets are measured on a pinned fixture corpus, browser build, hardware class, and clean profile, then tightened or given an explained delta.
- A green unit suite does not waive CDP smoke for a browser-owned path. A green CDP scenario does not waive deterministic tests.
- A stage with unexplained unhandled errors, flaky transitions, leaked resources, unbounded queues, or undocumented setting loss does not pass.

## Required program artifacts

The first stages create and maintain these artifacts. They are part of the work, not optional ceremony.

- Capability and UX inventory.
- Goldilocks setting ledger.
- State ownership map, including derived versus canonical state.
- Persistence registry covering database/store/key/version, record shape, quota behavior, reset/export/import policy, and rebuildability.
- Browser resource ledger covering owner, acquisition, cancellation, disposal, and diagnostic count.
- Entrypoint/worker/worklet/service-worker asset registry.
- Dependency graph and allowed import-direction rules.
- Playback backend and audio graph conformance matrix.
- Multiplayer wire, actor, generation, authority, cache, and per-peer resource matrices.
- Test fixture corpus manifest, including licensing/provenance and expected media facts.
- Performance baseline and budget file.
- Architecture decision records for every durable cross-domain contract.
- Deletion ledger showing which old owners and compatibility paths are gone.
- CDP scenario catalog and machine-readable final report.
- Residual manual/device verification checklist.

## Stage 0 — Declare the blast boundary

The director establishes a stable execution base before anyone rewrites code.

### Work

- Select the exact main commit that begins the nukepass and record its version, Multiplayer protocol version, Firebase rule version, dependency lock hash, and PWA manifest facts.
- Decide whether in-flight Multiplayer work lands before the checkpoint or moves to the nukepass branch as an explicitly owned slice. Do not continuously merge a moving experiment into a rewrite.
- Create a dedicated long-lived integration branch. Preserve the pre-nukepass commit as the behavioral oracle and easy recovery point.
- Define commit policy: each commit establishes one named invariant or completes one vertical cutover; “cleanup,” “misc fixes,” and numbered attempts are not acceptable descriptions.
- Define the fixture library and test data policy. Use tiny deterministic MP3, WAV, FLAC, Ogg, Opus, MOD/XM/S3M/IT/MO3, AHX/HVL, MP4/WebM/MKV, corrupt/unknown files, metadata/artwork/lyrics cases, and permission-loss handles where licensing permits.
- Record current supported versus conservatively file-associated extensions without forcing both lists to become identical.
- Build the initial risk register: data loss, silent audio, doubled audio, stale playback, unbounded memory/cache/queue use, service-worker staleness, file permission prompts at launch, metadata corruption, broken tool writes, protocol/rule drift, and installed-PWA-only regressions.

### Delegation

- One survey agent inventories capabilities and interaction paths.
- One inventories all settings and runtime consumers.
- One inventories persistence, files, handles, caches, channels, and backup behavior.
- One inventories browser resources and lifecycle owners.
- One inventories build entries, assets, PWA routes, manifest/file handlers, and update behavior.
- One Multiplayer survey group captures the desired post-checkpoint behavior and current protocol/cache reality.
- Independent reviewers cross-check each ledger against source searches and the UI catalogs.

### Gate

Every capability, setting, durable state surface, transient cache, browser resource type, entrypoint, worker/worklet, and external signaling surface has an owner or is recorded as an unresolved ownership defect. The chosen base commit remains runnable and recoverable. No implementation work has begun.

## Stage 1 — Freeze observable behavior and build the verification spine

The existing 138 Vitest files are valuable, but most browser behavior is mocked or pure. Before reconstruction, turn current observable behavior into executable contracts.

### Work

- Run and record the true baseline: `npm test`, `npm run check`, `npm run i18n:validate`, `npm run multiplayer:protocol:check`, `npm run test:firebase-rules` with the emulator, and `npm run build`.
- Record skipped tests, warnings, emitted page/worker/worklet/WASM assets, precache contents, chunk sizes, and startup console output. A failing baseline is documented and either repaired in an isolated prerequisite slice or carried as an explicit known defect.
- Add characterization tests at orchestration boundaries, not just helpers: rapid playback commands, transition supersession, hydration plus queued mutation, cross-window setting collisions, permission loss, folder reconciliation, tool cancellation, PWA update decisions, and Multiplayer generation replacement.
- Add fake clocks, deterministic IDs, bounded fake media backends, fake storage/capability ports, and resource counters where needed. Do not twist production behavior around a test framework.
- Check in the CDP harness described later in this document. It begins as a characterization harness against the baseline and grows with each stage.
- Check in the fixture corpus manifest and deterministic fixture generators where generation is more appropriate than binary storage.
- Add architecture checks for forbidden import directions and accidental browser-global access only after mapping current violations. Initially report them; ratchet them to errors as each domain is reconstructed.
- Add dead-code, cycle, coverage, and bundle-analysis tooling only after the behavioral baseline exists. Tool introduction must not mix thousands of mechanical fixes with the first architecture slice.

### Gate

The baseline is reproducible from a clean install. The CDP harness can launch a disposable profile, attach reliably, open the main page and all tool entrypoints, collect console/runtime failures, take screenshots and traces, and emit a machine-readable report. Current behavior is captured well enough that later differences are intentional rather than guessed.

## Stage 2 — Establish the target architecture and runtime kernel

This stage replaces cross-cutting improvisation before domain rewrites multiply it.

### Target dependency direction

```text
Svelte views / page roots
          |
          v
application view models + commands
          |
          v
domain controllers / actors / repositories
          |
          v
browser capability + resource adapters
          |
          v
Chromium APIs, IndexedDB, localStorage, Firebase, workers/worklets
```

Domain models and pure policies may be imported upward. Components do not import persistence, playback backend, signaling, or cache implementations. Browser adapters do not import Svelte components. Multiplayer wire types do not depend on application view models.

### Work

- Split the common type bucket into bounded contracts: media/catalog, playback/audio/DSP, settings, workspace/presentation, browser/window, tools/metadata, and Multiplayer wire/session. Keep a very small deliberate shared barrel only if it clarifies rather than conceals dependencies.
- Introduce injectable ports for clock, ID generation, logging, capability detection, storage, file access, and worker creation.
- Create a lifetime/scope owner that can register and idempotently dispose listeners, timers, intervals, RAF loops, AbortControllers, BroadcastChannels, workers, object URLs, media elements, audio routes/nodes, RTCPeerConnections/data channels, MediaSources, cache pins, and database connections.
- Require async operations to carry cancellation or generation identity when their result can become stale.
- Standardize structured errors at domain boundaries: unsupported capability, permission denied, unavailable handle, decode failure, corrupt media, quota exceeded, blocked database, autoplay suspension, network disconnect, stale generation, and cancelled work remain distinguishable.
- Rebuild logging around bounded per-context ownership, correlation IDs, safe structured details, batch cross-window history, and explicit diagnostic verbosity. Logs remain transient.
- Create one page bootstrap contract for theme, localization, logging, mobile document setup where applicable, scrollbar policy, service-worker registration policy, orphan detection, and teardown. Page-specific behavior remains explicit.

### Delegation

- Platform agents independently prototype resource scope, capability ports, and logging contracts.
- A type-boundary agent prepares the dependency graph and split without changing behavior.
- Page/runtime agents migrate entrypoints one at a time after the bootstrap contract freezes.
- An adversarial lifecycle reviewer injects failures during acquisition and teardown and checks idempotence.

### Gate

Resource-scope tests prove disposal after normal completion, replacement, error, cancellation, and repeated destroy. Architecture checks prevent newly reconstructed domains from bypassing their ports. All existing pages still boot. No product behavior or setting has been removed.

## Stage 3 — Reconstruct persistence, files, media identity, and catalog state

Persistence and file identity are rebuilt before playback and Multiplayer so those systems consume stable entities rather than retaining their own variants.

### Settings and lightweight state

- Replace ad hoc localStorage/BroadcastChannel patterns with one current-version settings engine.
- Make normalization a domain-owned pure function, not presentation behavior.
- Give writes origin and message IDs so storage events and BroadcastChannel delivery reconcile deterministically and duplicates are suppressed.
- Define atomic snapshot updates, reset behavior, unavailable/quota error behavior, and explicit lifetime cleanup.
- Preserve separate storage keys and scopes where they express real ownership; a shared engine does not mean one giant settings object.
- Reconcile main Options, mobile Options, tool Options, and runtime consumers through the setting ledger.

### IndexedDB and caches

- Introduce typed connection and transaction primitives with explicit `blocked`, `versionchange`, abort, quota, corruption, and close behavior.
- Preserve separate collection, handle, artwork-cache, playback-progress/bookmark, and rebuildable Multiplayer render-cache boundaries.
- Give rebuildable caches a common observable contract for list, size, clear, LRU eviction, and quota response without storing their payloads in playlist/library records.
- Resolve documentation drift around the newer bounded Multiplayer render disk cache: if retained, document it as separate, opt-in, compressed, rebuildable cache state; never reinterpret it as library persistence.
- Rebuild backups from an explicit registry. Exclude file handles, source media, transient presentation state, live meters, lyrics, pattern snapshots, and unbounded/rebuildable blobs unless an explicit backup feature says otherwise.
- On schema replacement, use clean current-version stores and delete or abandon incompatible pre-alpha stores. Do not write migration adapters.

### Files, metadata, and collections

- Define one canonical media entity: stable persisted identity and display path separated from ephemeral `File`, handle, object URL, decode state, permission state, and remote materialization.
- Make object URLs and materialized file access leases with explicit revocation. Only stream/video media-element paths receive object URLs.
- Centralize kind, extension, MIME, internal support, unknown-file verification, picker accept, folder scan, and conservative file-handler projections under one format policy.
- Preserve the rule that unknown verification uses a separate muted OpenMPT probe only for unknown files.
- Replace collection closure choreography with command-driven immutable state plus repositories and pure projections for selection, navigation, sorting, grouping, deduplication, and identity.
- Keep playlist duplicates, library deduplication, favorites identity, stable IDs/play counts, and separate persistence.
- Model hydration, mutation, persistence, background metadata work, and shutdown as explicit states. Eliminate anonymous pending-operation arrays whose ownership cannot be inspected.
- Build one bounded metadata pipeline shared by import, collection hydration, folder scans, playback, artwork, and tools. Tracker metadata remains a background probe; artwork and lyrics remain on-demand/transient.
- Rebuild managed-folder scans as plan/validate/apply transactions scoped to tracks owned by the folder. Test changed files, deletions, moves, permissions, duplicate identities, cancellation, and concurrent UI mutation.

### Gate

Fresh state, large collections, duplicates, reload, cross-window updates, quota failure, blocked upgrade, corrupt records, handle denial/regrant, externally changed files, launch scans, folder reconciliation, backup/restore, cache eviction, and teardown pass. Storage inspection proves no artwork/source/render/lyrics/pattern data crossed into playlist or library records.

## Stage 4 — Reconstruct playback and the shared audio graph

This is the highest-risk non-network stage. Preserve every backend and make orchestration deterministic.

### Backend contract

Define a capability-bearing adapter contract rather than pretending every backend is identical. The common surface should cover preparation, commit/play, pause, stop, seek, rate, state/metadata/error events, transition route, and teardown. Capabilities describe duration certainty, seekability, subsongs, patterns, native video surface, HTML media routing fallback, and offline rendering where relevant.

Keep separate adapters for:

- Howler HTML5 stream playback;
- Chiptune3/libopenmpt modules;
- Hively AHX/HVL modules;
- native video.

Each adapter gets a shared conformance suite plus format-specific cases. Backend quirks stay inside the adapter or an explicitly named browser policy, not in the application root.

### Playback state machine

- Replace callback-entangled sequencing with a serialized command/event machine.
- Model `idle`, `preparing`, `ready`, `playing`, `paused`, `seeking`, `transitioning`, `ended`, and `failed` only where they correspond to real legal behavior; do not create decorative states.
- Own active, prepared, and outgoing sources explicitly. Every load/transition receives a generation token and cancellation scope.
- Define rapid play/load/seek/next/previous/stop behavior, including A-to-B-to-C supersession, before implementing it.
- Keep repeat, shuffle history, restoration, bookmarks, Media Session, play-count thresholds, metadata hydration, subsongs, playback rate/true speed, video theater, and background resume as consumers of the authoritative machine.
- Never accrue play count from remote/Freeplay presentation or from discontinuous time below the configured threshold.

### Audio graph

Make the intended graph a tested declarative topology:

```text
Howler / OpenMPT / Hively / video / Multiplayer listener source
                         |
                         v
              per-source transition envelope
                    |                 |
                    |                 +--> raw program/broadcast tap where allowed
                    v
               per-source ReplayGain
                         |
                         v
                         Raf
                         |
                         v
                     analyser
                         |
                         v
                master volume/mute
                         |
                         v
                    destination
```

- Preserve the exact broadcast tap policy: host-rendered Multiplayer audio is dry renderer output after transport envelopes and before ReplayGain, Raf, analysis, or master volume; listeners own later processing.
- Ensure received Multiplayer sources can never feed the host broadcast tap.
- Preserve Howler backend volume only as fallback when media-element Web Audio adoption fails.
- Keep video's Auto Amp bypass source-scoped while allowing other Raf processing.
- Make gain changes differential, smoothed, finite, and anchored. Cover zero, mute/unmute, logarithmic volume, ReplayGain changes, effect reordering, crossfade overlap, and context resume.
- Give media elements, source nodes, transition routes, analysers, worklets, and offline renderers explicit lifetime ownership and diagnostic counts.

### Delegation

- Four backend agents implement against a frozen conformance contract.
- One audio-graph agent owns topology and routing policy.
- One controller agent owns command/state semantics.
- Separate agents cover Media Session/restoration/play counts and patterns/metadata integration.
- An adversarial audio reviewer attacks doubled routes, silence, stale ended events, crossfade leaks, unsupported adoption, and interrupted AudioContext behavior.

### Gate

The full backend-switch matrix passes: every backend to itself and every other backend, with no transition, fadeout, and crossfade where supported; rapid supersession; pause/seek/stop; end/navigation; errors; permission loss; autoplay suspension; visibility changes; volume/mute/ReplayGain/Raf changes; and teardown. CDP graph telemetry shows one intended audible route, advancing clocks, stable resource counts, and no stale source after replacement.

## Stage 5 — Reconstruct Multiplayer as actors, strategies, and bounded resources

Multiplayer is a first-class program within the nukepass. It is not postponed to “clean up later,” and it is not allowed to dictate duplicate state throughout the rest of the app.

### Checkpoint and authority model

- Freeze the desired behavior from the latest accepted Multiplayer checkpoint, including the bounded persistent render-cache decision.
- Bump the experimental protocol once when the new contract is coherent. Do not reproduce an intermediate version march.
- Keep the host authoritative for its catalog and hosted playback.
- Keep a joined client as a remote projection plus commands, never a second writer to host persistence.
- Keep each Freeplay client as an independent per-pair actor with its own host-side renderer/timeline, queue, selection, navigation history, preparation, and resource scope.
- Freeplay never routes through or mutates the host playlist or shared player controller.

### Wire and signaling

- Turn protocol definitions into a versioned schema/codec layer with structural validation, discriminated messages, explicit size/range limits, binary frame validation, and fuzz/property tests.
- Generate or mechanically synchronize Firebase validation facts from the same protocol source. The non-writing check and emulator rules suite are mandatory gates.
- Treat authentication, invite/room lifecycle, directory records, pairing, TURN credential exchange, ICE candidates, and reconnect ownership as separate signaling concerns.
- Keep TURN secrets out of logs, wire diagnostics, persisted recents, and client-visible state.
- Reject hostile message sizes, invalid generations, malformed ranges, peer floods, and resource requests before behavioral actors see them.

### Session actors and peer scopes

- Replace host/client closure bags with event-queued actors and explicit legal transition tables.
- Give session, role, peer, delivery generation, transfer/render request, and Freeplay timeline distinct identifiers rather than reusing one boolean or token for unrelated readiness.
- Make reset/destroy idempotent. Async continuations from a previous role/session/generation become inert by identity, not by carefully ordered timer clearing alone.
- A peer scope owns its RTCPeerConnection, candidate state, channels, outgoing queues, transfer fragments, render cache pins, monitors, readiness, Freeplay player, and timers. Removing the peer disposes the scope completely.
- Reconnect work has one owner and cannot survive an explicit leave. Host restart/restore has one defined negotiation path.

### Delivery strategies

Retain explicit strategies:

- **source file:** bounded whole-file transfer over the media channel; the client plays locally through the appropriate backend, so tracker modules retain native module behavior;
- **buffered Opus:** host offline render to time-indexed WebM/Opus, reliable unordered transfer with small bounded in-flight work, client sparse storage plus MSE playback;
- **video RTP:** the only live RTP media path.

The “Send files under” setting remains the pathway selector. `0`, strict finite MiB thresholds (a file exactly at the threshold still renders), and “Every file” retain their intended semantics. Opus bitrate, start/rebuffer window, memory cache limit, disk cache enable/limit, synchronized lead time, wait-for-clients, listener limit, restore, force-TURN, and Freeplay controls remain connected and observable.

### Render, cache, transfer, and playback reconstruction

- Model offline render as a bounded producer/consumer pipeline. Regular audio and module renderers share container/encoder output contracts without retaining whole-track PCM.
- Make render cache keys explicit and test source revision, subsong, renderer version/settings, sample rate, channel layout, and bitrate behavior.
- Use lease/pin ownership so active renders cannot be evicted. Deduplicate concurrent host and Freeplay requests without copying cluster payloads per peer.
- Keep memory and disk caches bounded, inspectable, clearable, rebuildable, and separate from collection/service-worker storage.
- Express scheduler fairness and priority: newest seek startup window, authoritative playhead protection, forward download-ahead, earlier holes/speculation. Bound channel queued bytes and stale in-flight work.
- Client render playback owns one generation-scoped MediaSource pipeline, retained compressed ranges, init/manifest race handling, sparse append order, readiness/rebuffer policy, seek replacement, listener audio route, and teardown.
- Retain higher-bitrate complete-cache substitution only if its current semantics survive a dedicated contract review.
- Replace one-shot diagnostic anecdotes with structured generation-correlated events and counters for render time, cache result, bytes, queue pressure, readiness, rebuffer, recovery, and teardown.

### Deterministic simulation matrix

Before CDP, run host/client actors against fake signaling, RTC channels, renderers, clocks, and storage. Cover:

- duplicate, dropped, delayed, reordered, malformed, and oversized messages;
- init before manifest, manifest before init, fragmented init, and stale epochs;
- rapid A-to-B-to-C selection and repeated forward/backward seeks;
- source-file to render to source-file transitions and render failure fallback;
- paused download-ahead, buffered-edge rebuffer, cache hit/miss/eviction/substitution, and interrupted persistence;
- Co-op, Co-op with audio, Freeplay, audio refusal/re-enable, synchronized start, and listener join/leave;
- multiple peers requesting the same render and different Freeplay timelines;
- reconnect during signaling, transfer, render, ready, playing, paused, and seeking;
- host restart with persisted intentional session state, explicit leave, and protocol mismatch;
- renderer, worker, channel, MediaSource, AudioContext, cache, IDB, and permission failures;
- teardown assertions for every peer, queue, pin, element, URL, worker, channel, timer, and monitor.

### Delegation

One Multiplayer integration lead coordinates separate agents for protocol/security, Firebase/signaling, peer/ICE/data-channel lifecycle, source transfer, render/encoder/cache, MSE client playback, hosted authority, Freeplay, receiver diagnostics, and deterministic simulation. A reviewer from the playback team audits graph-entry and backend ownership. A persistence reviewer audits cache boundaries. None of the core implementers signs off its own multi-peer race matrix.

### Gate

Protocol check, protocol fuzz/property tests, Firebase emulator rules, actor transition tests, multi-peer simulations, cache/quota tests, and full repository gates pass. Then two- and three-profile CDP scenarios pass on loopback and throttled networks for all delivery modes, supersession, reconnect, restart, and resource cleanup. No compatibility adapter remains.

## Stage 6 — Replace the application root with explicit orchestration

Only after catalog, playback, and Multiplayer contracts settle should the central application projection be rebuilt.

### Work

- Create an application controller/session facade that composes collection state, playback, workspace, presentation, windows, tools, and Multiplayer.
- Expose read-only, cohesive view models for local, hosted, joined, and Freeplay modes. Remote projection does not overwrite local canonical state; the view model selects the appropriate source deliberately.
- Route all UI intent through typed commands. Commands return explicit accepted/rejected/pending outcomes where the UI needs them.
- Move selection reconciliation, remote catalog pruning, playing-track projection, toast/dialog state, artwork/lyrics/pattern availability, Track Details targeting, mobile/desktop mode projection, and shutdown into named owners.
- Keep transient presentation controllers transient. Do not persist artwork surfaces, lyrics, meters, patterns, open menus, or derived remote state.
- Make startup and shutdown staged: capability/bootstrap, persistence hydration, application session, browser integrations, render mount; reverse that order at teardown.
- Reduce `App.svelte` to subscription, composition, binding of the video parking/stage host, and dispatch. Do not move the same hidden mutable root into one enormous `app-controller.ts`.

### Gate

Architecture checks show no business logic in the root component and no presentation import in domain controllers. Local/host/client/Freeplay projections have deterministic tests. Switching modes cannot destroy or mutate local collection/selection/playback state accidentally. Browser smoke covers startup, hydration, mode changes, shutdown, and reload.

## Stage 7 — Reconstruct workspace, desktop UI, mobile, and Options

The visible application is rebuilt around stable view models without redesigning izci into a website.

### Workspace and collections

- Separate dock layout calculation, tab placement/open state, resize policy, contextual Lyrics/Patterns visibility, and presentation markup.
- Preserve Playlist, Library, Details, Lyrics, Patterns, and Video docking; wide proportions; automatic contextual tab controls; Now Playing; video theater; narrow-panel behavior; and backdrop clipping/contrast rules.
- Rebuild Playlist/Library views around reusable dense row/table/group projections with bounded virtualization and pure search/sort/group navigation.
- Preserve desktop selection, focus, range/toggle behavior, keyboard navigation, double-click-to-play, context menus, ratings, columns, group drilldown, album backdrops, and “keep columns visible” behavior.
- Treat menu, focus, keyboard, accessible names, high contrast, reduced motion, and zoom as behavior, not polish deferred to the end.

### Desktop and mobile

- Desktop and mobile consume the same application facade but keep separate roots and CSS.
- Preserve the mobile page order: Playlist, Library, Now Playing, Lyrics, Details.
- Preserve bottom-nav/swipe consistency and exclusions for controls with their own horizontal gestures.
- Preserve touch-first mobile rows and tap-to-play without changing desktop selection/double-click semantics.
- Preserve mobile Multiplayer statistics and full-page shared Options content. Tool windows remain intentionally absent on mobile unless separately reconsidered.
- Test narrow desktop as desktop; do not infer mobile from viewport width.

### Options

- Build a settings registry that records ownership, normalization, default, range, dependencies, sync, reset, and runtime application.
- Use the registry to prevent drift and power verification, not to force complex Raf editors, cache management, folder management, loadouts, or appearance controls into generic widgets.
- Keep category structure and the Goldilocks setting ledger intact. Repair disabled states and explanatory hints when control dependencies change.
- Keep Options as a separate window editing stores, never an owner of audio nodes or main collection mutation.
- Reuse the same content/view models for mobile Options while retaining its full-page presentation.
- Regenerate English/Turkish catalogs only through the documented localization workflow. Never automatically update Askew.

### Delegation

Desktop workspace, collection presentation, player/Now Playing/video, mobile shell, Options infrastructure, specialist Options editors, accessibility/keyboard, and visual-regression work proceed as separate lanes against frozen view models. An independent design reviewer checks density and desktop character at every visual gate.

### Gate

CDP interaction and screenshot matrices pass at wide desktop, narrow desktop, zoomed desktop, light/dark/theme variants, reduced motion, and emulated mobile. Keyboard-only walkthroughs pass. Every setting in the ledger appears in the intended presentation, persists/synchronizes correctly, and reaches its runtime consumer. No component has acquired playback, persistence, or signaling ownership.

## Stage 8 — Reconstruct tools and shared media workbench infrastructure

Tools remain separate applications. The common work is lifecycle and media infrastructure, not a mega-tool component.

### Shared tool runtime

- Standardize page bootstrap, theme/i18n/logging, Window Controls Overlay, menu/focus policy, popup reuse/orphan behavior, window-state persistence, drag/drop routing, keyboard shortcuts, jobs/progress/cancellation, and teardown.
- Define typed handoff with the main application for current/selected track context and completed Troubadour mutations.
- Ensure every worker, object URL, decoded buffer, waveform/spectrogram allocation, temporary file, handle, listener, and job has a scope.
- Keep domain controllers independent: compare, edit/export, convert, log inspection, metadata/group/rename/write.

### Tool-specific reconstruction

- **Audio Compare:** deterministic source lifecycle, matched comparison state, audio routing ownership, cancellation, and bounded decoded data.
- **Editor:** waveform viewport/model separation, effect preview graph, module render worker, metadata/lyrics edits, export preflight, cancellation, and format-specific output contracts.
- **Converter:** bounded queue, worker protocol, codec capability/error model, output collision/preflight, metadata policy, and clean cancellation.
- **Logs:** bounded per-context merge, filters/columns/export, batch rendering, malformed detail safety, and no persistence.
- **Troubadour:** transient workbench state machine; shared metadata reader/writer/remux infrastructure; album grouping; artwork; lyrics/loudness/spectrogram; preview-first renames; permission/write preflight; history; and result synchronization without direct playlist/library mutation.
- **Troubadour Options:** shared current-version settings with its own ownership and window lifecycle.

### Gate

Every tool opens, focuses/reuses, accepts its supported handoff/drop inputs, completes a representative job, cancels safely, handles permission/codec/write failure, exports expected output, and closes without retained workers/media/object URLs. Metadata round trips preserve unknown data and untouched artwork. Main collection updates retain IDs and play counts.

## Stage 9 — Reconstruct build, entrypoints, PWA, and offline behavior

Build configuration is application behavior because izci is installed, offline, multi-page, and worklet-heavy.

### Work

- Create one declarative page registry and derive Vite multi-page inputs, popup paths/default dimensions where appropriate, and service-worker navigation fallback denylist.
- Create an asset contract for workers, worklets, WASM/memory, icons, fonts, and other runtime-fetched files. Preserve the fixed Chiptune3/libopenmpt worklet relationship and verify emitted paths/content.
- Derive conservative manifest file-handler entries from an explicit allowlist over the canonical format policy. Internal support may remain broader.
- Preserve production-only service-worker registration unless separately justified.
- Test update discovery, waiting/activation/reload behavior, long-lived windows, multi-window update coordination, and Force Update.
- Test fresh online install state, warm offline launch, cold-ish offline launch after precache, every page's navigation behavior, and cache size/exclusion policy.
- Isolate heavy Firebase, codec, worker, tool, visualizer, and metadata code into lazy chunks only where traces show startup benefit and offline loading remains reliable.
- Add artifact assertions for all entry HTML, manifests, service worker, page chunks, render/editor/converter workers, libopenmpt/Hively assets, icons, fonts, and navigation fallbacks.

### Gate

A clean production build emits every declared artifact and no undeclared required runtime fetch. CDP opens each page online, reloads it offline, and verifies correct shell/navigation behavior. Update scenarios do not serve stale hashed code. Installed-PWA-only WCO/file-handler/launch behavior remains on the manual/device checklist rather than being falsely certified by a tab.

## Stage 10 — Measured efficiency and reliability pass

Only now is “efficiency” optimized across stable ownership boundaries.

### Baselines

Measure with pinned fixtures and profiles:

- main/tool startup time, transferred/parsed script, and first useful render;
- idle CPU/wakeups in paused and playing states;
- main-thread long tasks during import, metadata scan, folder reconciliation, artwork analysis, patterns, visualizers, tool jobs, and Multiplayer render/transfer;
- heap and resource counts across repeated tracks, crossfades, seeks, workspace changes, tool opens, and session reconnects;
- IndexedDB read/write volume, transaction count, debounce behavior, and quota response;
- object URL, media element, AudioNode, AudioWorklet, Worker, RAF, timer, listener, BroadcastChannel, peer, data channel, SourceBuffer, and cache-pin counts;
- render time, compressed size, cache hit/eviction, queued bytes, time to ready, rebuffer count, and multi-peer fairness;
- bundle/chunk/precache size and duplicate dependencies.

### Optimization rules

- Optimize measured causes: repeated full-array cloning, high-frequency store publication, unbounded concurrency, duplicate decoding, unnecessary eager backend creation, retained resources, oversized root subscriptions, redundant IDB writes, main-thread media work, or excessive data-channel queueing.
- Prefer immutable projections with structural sharing, keyed/differential updates, bounded work queues, worker offload, virtualization, cache leases, and coalesced telemetry where evidence supports them.
- Do not trade deterministic correctness for timer heuristics or obscure lifecycle coupling.
- Do not disable visualizers, artwork, DSP, metadata, persistence, Multiplayer diagnostics, or settings to win a benchmark.
- Record before/after traces and explain any regression accepted for behavior or maintainability.

### Reliability/adversarial pass

- Inject storage quota/full disk, permission revocation, external file change, corrupt tags/media, worker crash, AudioContext suspension, failed media-element graph adoption, service-worker update mid-session, BroadcastChannel absence/duplication, popup blocking, network loss/reordering, TURN failure, renderer failure, and peer hostility.
- Fuzz pure parsers, protocol decoders, range/fragment handling, metadata containers, rename templates, and persisted-state normalizers within bounded resource limits.
- Run long soaks for playback backend cycling, crossfades, folder scans, artwork/visualizer changes, tool job cancellation, host/client reconnect, Freeplay switching, and cache churn.

### Gate

Measured budgets pass with no unexplained regression. Long soaks show bounded heap and resource counts after settling. Every intentional fallback is observable and tested. There are no correctness timers whose values are unexplained by a browser constraint and bounded by a named policy.

## Stage 11 — Eradication and hostile whole-tree review

This is where the nukepass earns its name. Once replacements pass their domain gates, remove the old architecture completely.

### Work

- Delete superseded controllers, services, stores, helpers, duplicate types, adapters, feature flags, shadow reads/writes, protocol fields, stale tests, obsolete CSS, unused assets, and abandoned documentation.
- Remove temporary compatibility/differential scaffolding and test-only global hooks that are not part of the committed CDP adapter design.
- Collapse barrels that obscure cycles. Enforce domain import direction.
- Re-run unused export/dependency, duplicate implementation, cycle, bundle, storage-key, channel-name, browser-global, timer/listener, and resource-owner audits.
- Search for stale terminology and settings labels after localization regeneration. Askew is inspected manually.
- Review comments for old invariants and TODOs. Keep comments that explain browser constraints; delete archaeological narration that no longer describes the code.
- Compare the capability, setting, persistence, resource, entrypoint, and Multiplayer ledgers against the final tree.

### Hostile review teams

- **Functionality team:** attempts to find a missing product capability or altered interaction.
- **Goldilocks team:** traces every control from UI to normalized state to runtime effect.
- **State team:** finds duplicate canonical state, mutable projections, stale-event acceptance, and unclear authority.
- **Resource team:** finds unowned allocation, non-idempotent teardown, retained listeners/nodes/workers/URLs/peers, and unbounded queues/caches.
- **Persistence team:** inspects actual IDB/localStorage records and cross-window ordering.
- **Playback team:** attacks every backend transition and graph invariant.
- **Multiplayer team:** attacks protocol boundaries, generations, reconnection, cache leases, Freeplay separation, and hostile peer limits.
- **UI team:** attacks keyboard, focus, density, narrow desktop, mobile gestures, localization, WCO-safe geometry, and “website-y” drift.
- **Build/PWA team:** attacks all pages, offline routes, update behavior, worklet/worker assets, and stale service workers.

No team reviews only diffs. Each reviews the final tree and runs focused adversarial scenarios. Findings are resolved or explicitly accepted with owner, consequence, and follow-up date.

### Gate

The deletion ledger is empty except for explicitly accepted future work. No parallel old/new architecture remains. The final dependency/resource/storage audits match their target rules. The application still passes every prior stage gate.

## Stage 12 — Final verification and release decision

Final verification runs from a clean checkout/profile against the exact commit proposed to replace the pre-nukepass line.

### Static and deterministic gates

Run and record at minimum:

```sh
npm ci
npm test
npm run check
npm run i18n:validate
npm run multiplayer:protocol:check
npm run test:firebase-rules
npm run build
```

Also run the final architecture, cycle/dead-code, artifact, bundle-budget, property/fuzz, simulation, and soak suites added by the program. Verify that the build did not unexpectedly rewrite protocol rules, that generated English/Turkish catalogs are current, and that Askew was not automated.

### Production CDP gate

Start only the explicitly approved production-preview and test signaling/emulator processes. Launch the checked-in CDP harness with fresh disposable browser profiles and the exact built artifacts. Run the complete matrix below, collect its report bundle, and repeat the flake-sensitive transition/soak groups enough times to expose ordering bugs.

Any unhandled runtime exception, unexpected console error, failed resource budget, stale service worker, missing artifact, storage-boundary violation, stuck loading/preparing state, non-advancing expected clock, or leaked final resource fails the gate. Expected capability denials must be asserted as expected, not globally ignored.

### Manual/device gate

Run the residual checks CDP cannot honestly prove:

- installed PWA launch and update on the target Chromium build;
- Window Controls Overlay visibility/geometry and title-bar interaction;
- OS file-handler and Launch Queue behavior;
- real picker permission prompts and restored handles;
- physical audible output and silence/double-audio checks;
- Android Chromium mobile shell, background/foreground, device lock, output capture, and real touch gestures;
- same-Wi-Fi direct ICE, mobile-path change, and TURN-relayed Multiplayer where infrastructure permits.

### Release decision

The review director publishes:

- exact commit and build identity;
- commands and pass/fail counts;
- CDP report/traces/screenshots/log bundle;
- performance comparison and explained deltas;
- persisted-state reset consequences;
- protocol/Firebase deployment pairing;
- residual manual results;
- explicitly accepted risks, if any;
- confirmation that the pre-nukepass recovery point remains identifiable.

The nukepass is complete only when no required work remains. Near-complete stages, a green build, or one successful listening session are not sufficient.

## CDP harness specification

The browser harness is built in Stage 1, used at every wave boundary, and becomes the final acceptance instrument in Stage 12. Previous two-instance Helium rigs proved the value of CDP but are described only in historical docs; private throwaway scripts are not an acceptable program dependency.

### Harness properties

- Checked into the repository with documented prerequisites and no dependency on one developer's profile or absolute browser path.
- Accepts a Chromium/Chrome/Helium executable parameter.
- Creates unique temporary user-data directories and discovers/allocates debugging ports safely, preferably through `DevToolsActivePort` rather than assuming 9222/9223.
- Supports one, two, and three isolated profiles plus multiple same-profile windows for BroadcastChannel and update tests.
- Records browser version, OS, commit/build ID, fixture set, flags, ports, profile IDs, service-worker versions, protocol version, and scenario seed.
- Uses raw CDP or a thin pinned client; it does not require a large browser framework unless that framework provides clear value over the protocol.
- Always cleans up child browsers and temporary profiles, while retaining failure artifacts on request.
- Emits structured JSON plus readable summary, screenshots, DOM snapshots, console/runtime logs, network log, performance trace, heap/resource snapshots, and Multiplayer diagnostics.
- Has deterministic wait conditions based on application state/events. Arbitrary sleeps may bound a browser operation but never prove readiness.
- Fails closed on lost CDP targets, unexpected navigation, stale build, old service worker, uncaught exception, rejected promise, or timed-out state.

### Test seams

Native file/folder pickers and installed-PWA surfaces cannot always be driven reliably through CDP. Add narrow test adapters at the browser capability boundary:

- fixture-backed file and directory handle injection with the same application-facing contract as real handles;
- programmable permission states and external-file revisions;
- observable resource/lifecycle counters available only in test builds or through a guarded diagnostic protocol;
- deterministic clocks/IDs/network adapters only for simulation suites, not for the final real-browser media paths;
- graph telemetry that reports topology, gains, context state, source identity, and analyser energy without shipping captured audio.

The adapter must not provide a privileged alternate business path. At least one manual/device scenario exercises each native surface it substitutes.

### Single-instance matrix

- Clean first launch, hydration, reload, shutdown, and restoration.
- Add fixtures to playlist/library; duplicates, favorites, ratings, search, sort, groups, selection, navigation, repeat, shuffle, play counts, and managed folder reconciliation.
- Permission denial, regrant, unavailable handle, changed file, unknown-module verification on/off, corrupt media, and object URL revocation.
- MP3/WAV/FLAC/Ogg/Opus, OpenMPT formats, AHX/HVL, and MP4/WebM/MKV playback.
- Every backend-to-backend transition, transition mode, seek, rate, true-speed, volume/mute/logarithmic control, ReplayGain, Raf effect change, analyser/visualizer, metadata, artwork, lyrics, patterns, Media Session state, video stage/theater/PiP-safe fallback, and restoration.
- Rapid command storms and cancellation during load/metadata/artwork/transition.
- Workspace docking, tab open/close/automation, resize, Now Playing, backdrops, menu actions, keyboard/focus, wide/narrow desktop, zoom, themes, reduced motion, and WCO unavailable geometry.
- Main Options and mobile Options: every setting changed, normalized, synchronized across windows, applied at runtime, reset, and restored.

### Tool/page matrix

Open all eight build entrypoints: main, Options, Audio Compare, Editor, Converter, Logs, Troubadour, and Troubadour Options.

- Verify page boot, theme/localization, WCO-safe layout, popup reuse/focus, orphan behavior, keyboard/menu commands, error capture, and clean close.
- Run representative compare, edit/export, conversion, log exchange/export, metadata/artwork/lyrics/loudness/spectrogram/group/rename/write, and Options operations.
- Cancel jobs at early/middle/late phases and inject worker, codec, permission, collision, metadata, and write failures.
- Confirm workers, object URLs, media elements, decoded buffers, job subscriptions, and window channels return to baseline.

### PWA/offline/update matrix

- Verify source/dev characterization detects and rejects a stale production service worker.
- Verify the production build online, then reload every page offline.
- Inspect registration, active/waiting worker, precache entries, runtime fetch failures, navigation fallback and denylist behavior.
- Exercise update discovery with an old long-lived window, new build, multiple windows, user deferral/acceptance, Force Update, and reload.
- Assert worker/worklet/WASM assets load from the intended build and do not silently fall back to an older cache.
- Treat installed launch, file handlers, and WCO as manual/device residuals.

### Multiplayer matrix

Use isolated host, client, and optional second-client profiles. Exercise:

- protocol match and mismatch;
- invite join, paired rejoin, host-full, refusal, leave, explicit reconnect, host restart, and restored session;
- Co-op without audio, Co-op with audio, and Freeplay;
- source-file audio/module playback, buffered Opus audio/module playback, render failure to source-file fallback, and video RTP;
- transfer threshold boundary values, every-file, all-render, bitrate, startup/rebuffer window, memory/disk cache enable/limits, synchronized lead/wait, receive-audio, listener limit, and TURN policy;
- host-authoritative transport, client controls, Freeplay independent queues/timelines, repeat/shuffle, simultaneous peers, and no host collection/player mutation from Freeplay;
- rapid selection, seek storms, pause/resume, track replacement during preparation, stale readiness/fragments/events, init/manifest order, cache rejoin/substitution/eviction, and interrupted disk cache;
- latency, bandwidth restriction, offline/online, connection drop, target close/reopen, signaling replacement, and TURN relay where available;
- download-ahead, queue high-water, fairness, ready/rebuffer time, bytes, cache pins, element/MSE ranges, graph entry, and teardown.

CDP can verify playback clocks, MSE ranges, AudioContext state, analyser energy, graph/source identity, sender/receiver stats, DOM state, messages, cache content, and absence of duplicate routes. It cannot alone prove that a speaker produced clean audible sound.

### Performance and leak matrix

- Repeat hundreds of play/seek/transition cycles across all backends.
- Open/close each popup and tool repeatedly.
- Alternate workspace and backdrop modes while playing.
- Import/rescan a large synthetic collection and cancel/restart metadata work.
- Run long visualizer/pattern/DSP sessions.
- Reconnect Multiplayer, switch Co-op/Freeplay, churn renders/caches, and add/remove peers repeatedly.
- Capture traces and heap/resource snapshots at baseline, peak, settled, and final states.
- Assert bounded final deltas for listeners, timers, RAFs, object URLs, elements, audio nodes, workers, channels, peers, SourceBuffers, cache pins, queued bytes, and heap. Budgets come from measured healthy baselines, not arbitrary round numbers.

## Cross-stage acceptance matrices

### Playback paths

| Source | Preparation and playback | Shared graph | Special acceptance |
| --- | --- | --- | --- |
| Regular audio | Howler HTML5 | Web Audio when adoptable; Howler volume fallback otherwise | Metadata/artwork/lyrics/ReplayGain and object URL lifecycle |
| OpenMPT module | Chiptune3/libopenmpt | Shared Web Audio context | Subsong/pattern/metadata, unknown probe, worklet asset |
| AHX/HVL | Hively worklet/replayer | Shared Web Audio context | Patterns/metadata and renderer parity where required |
| Video | Native video element | Shared graph where Chromium permits | Video surface, PiP/fullscreen/theater, Auto Amp bypass only |
| Multiplayer source file | Client-native matching backend | Listener-owned chain | No host timeline for Freeplay local playback |
| Multiplayer buffered Opus | Client MediaSource element | Listener-owned chain | Sparse seek/rebuffer/cache/generation behavior |
| Multiplayer video | Live RTP | Listener route | Only remaining RTP media path |

Every row is tested for load, play, pause, seek, end, error, replacement, settings changes, background/resume, and teardown where meaningful.

### Persistence boundaries

| Data | Boundary | Forbidden result |
| --- | --- | --- |
| Playlist/library/favorites | Separate collection IndexedDB state | Embedded artwork, lyrics, render bytes, transient files/URLs |
| Reusable directory handles | Separate handle IndexedDB | Permission prompts during launch scan |
| Settings/UI state | Current-version localStorage stores + synchronized messages | Audio nodes, collection mutation, duplicate delivery |
| Artwork renditions | Separate bounded rebuildable artwork-cache IDB | Artwork blobs in track records |
| Multiplayer rendered media | Separate bounded rebuildable render-cache IDB when enabled | Service-worker or collection persistence; unbounded growth |
| Logs/meters/patterns/lyrics/live UI | Transient memory only | Any durable persistence |

### Required checks by change domain

| Domain | Minimum focused gate in addition to required build |
| --- | --- |
| Pure/domain helper | Focused Vitest; property/fuzz test where parser/state space warrants it |
| Svelte/UI | `npm run check`, focused view-model tests, CDP interaction/screenshot smoke |
| Interface copy | i18n extraction/sync workflow, `npm run i18n:validate`, manual Askew review |
| Persistence/settings | Race/reload/quota/cross-window tests and CDP storage inspection |
| Playback/audio | Backend/graph/controller tests and CDP media smoke |
| Multiplayer | Protocol check, focused simulations, Firebase rules when relevant, multi-profile CDP |
| Build/PWA | Artifact assertions and production online/offline/update CDP |
| Tool worker/export/write | Worker/job tests, format round trip, cancellation/error CDP |

## Stop conditions and recovery

Pause a stage and return to the last accepted checkpoint when:

- a canonical owner cannot be identified without changing product semantics;
- the proposed contract forces deletion or silent reinterpretation of settings;
- a storage change risks source media, handles, IDs, play counts, or non-rebuildable user state beyond the declared scorched-earth reset;
- playback has unexplained silence, doubled routing, broken fallback, or cross-backend regression;
- Multiplayer authority or Freeplay isolation becomes ambiguous;
- production build/offline/update behavior cannot be reproduced;
- CDP or deterministic tests expose nondeterministic stale work whose owner is unknown;
- a performance improvement depends on disabling behavior or hiding diagnostics;
- parallel agents collide on an unfrozen shared contract.

Recovery means reverting or abandoning the isolated slice, not adding another adapter or timer around an unproven model. Record the failed assumption and minimal reproduction before choosing a new design.

## Definition of done

The nukepass is done when:

- the capability and Goldilocks ledgers show intentional preservation or an explicit product decision for every item;
- application, domain, browser, presentation, and Multiplayer ownership is explicit and enforced by dependency checks;
- `App.svelte` and tool/page roots are composition surfaces rather than hidden service layers;
- every persistent datum and rebuildable cache is in its declared boundary with tested reset/quota/error behavior;
- every browser resource has an owner, cancellation path, idempotent disposal, and bounded diagnostic count;
- stream, OpenMPT, Hively, video, source-file, buffered Opus, and video RTP paths pass their complete matrices;
- Freeplay remains an independent host-side authority per pair, with delivery-specific timeline ownership, and never mutates the host's shared playlist/player;
- protocol and Firebase rules are generated/synchronized at one incompatible current version with no adapters;
- desktop, narrow desktop, mobile, Options, and tools retain their intended UX and keyboard/touch behavior;
- build inputs, popups, navigation fallbacks, workers/worklets/WASM, manifest/file handlers, offline cache, and update behavior agree;
- measured performance/resource budgets pass and long soaks settle without leaks;
- superseded paths, duplicate state, temporary bridges, stale docs, and compatibility scaffolding are deleted;
- full static/deterministic gates pass from a clean checkout;
- the exact production build passes the committed single-, multi-page, PWA, performance, and multi-instance CDP matrices;
- residual installed-PWA, physical-audio, Android, and real-network checks are signed off without claiming CDP proved them;
- the final report identifies the exact accepted commit and no required work remains.

Until then, the pre-nukepass commit is the behavioral oracle and recovery point. The purpose of going thermonuclear is not to leave a crater. It is to emerge with one smaller, clearer, current-version system that still unmistakably behaves like izci.
