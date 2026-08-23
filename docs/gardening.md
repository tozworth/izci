# Gardening pass

The gardening pass is a cautious, evidence-led review of izci. Its purpose is
to remove defects, dead weight, accidental duplication, and locally confusing
code without reconstructing the application or imposing a new architecture.

The current application is the implementation to improve, not a disposable
prototype. Complexity that follows from izci's product surface is not itself a
defect. A successful pass may conclude that a complicated subsystem should be
left alone.

## Operating model

Each phase has one GPT-5.6 Sol owner and exactly three GPT-5.6 Luna auditors.
The Sol owner remains responsible for the whole phase:

1. Inspect the phase boundary, relevant tests, and current worktree state.
2. Start three Luna auditors in parallel with disjoint review questions.
3. Require the Luna auditors to work read-only. They never edit, format,
   generate, or delete files.
4. Collect all three reports before deciding what is actionable.
5. Independently verify every accepted finding against the source and tests.
6. Apply the accepted edits itself in small coherent batches.
7. Run the required verification after each source change, including
   `npm run build`, and focused tests or `npm run check` when relevant.
8. Record a concise phase result: accepted findings, rejected findings and why,
   files changed, verification run, and residual risks.

Three auditors is intentional: it fills the available parallel slots while the
Sol owner retains coordination and synthesis. Luna findings are leads, not
instructions. The Sol owner must reject weak, duplicative, speculative, or
disproportionate recommendations.

The phases run sequentially. A phase may inspect adjacent code needed to
understand behavior, but it must not opportunistically edit another phase's
area. Unrelated existing worktree changes belong to the user and must be
preserved.

## Rules for Luna auditors

Every Luna prompt must include these constraints:

- Work read-only. Do not modify the repository.
- Report no more than five findings, ordered by practical impact.
- Cite exact files and line numbers and trace relevant callers or consumers.
- Read nearby tests before claiming behavior is untested or incorrect.
- Distinguish confirmed defects from suspicions.
- For each finding, state the observable failure or concrete maintenance cost,
  the smallest plausible correction, regression risk, and focused verification.
- File length, import count, browser API use, an import cycle, or disagreement
  with an abstract layering rule is not a finding by itself.
- Do not propose a new framework, generic repository, runtime kernel, resource
  scope, settings engine, contract hierarchy, registry, adapter layer, or broad
  file reshuffle.
- Do not recommend compatibility layers or migrations unless explicitly
  required by current behavior.
- Prefer local deletion, consolidation, naming repair, race/leak fixes, and
  simpler control flow over abstraction.
- Explicitly say when reviewed complexity is justified and should be left
  alone.

Each report uses this shape:

```text
Finding: short description
Confidence: confirmed | likely | speculative
Evidence: file:line references and relevant execution path
Impact: observable defect or concrete maintenance cost
Smallest fix: bounded correction, without implementation
Regression surface: behavior that could be disturbed
Verification: focused tests/checks that would establish the fix
```

Speculative findings are not implementation candidates during the same phase.
They may become narrowly scoped follow-up investigations.

## Sol triage gate

Before editing, the Sol owner must be able to answer all of the following for
an accepted finding:

1. What currently breaks, leaks, duplicates work, or becomes materially harder
   to change?
2. What source and test evidence establishes that?
3. Can the issue be corrected locally?
4. Does the correction remove or simplify more concepts than it introduces?
5. What focused verification would fail before the correction or otherwise
   establish the intended invariant?

Reject recommendations whose main benefit is architectural purity, uniformity,
future flexibility, reduced line count, or movement behind another interface.
Two auditors noticing the same pattern increases review priority but does not
replace the Sol owner's verification.

Production code should be net-negative in size by default. Net growth is
reasonable for a demonstrated bug fix, missing guard, or focused test, but the
phase report must explain it. A shared abstraction is permitted only when at
least three current call sites need materially identical behavior and the
result is demonstrably simpler than the local implementations.

## Phase 1: low-risk debris and false signals

Establish a clean factual baseline and take only low-risk wins.

- Luna A reviews possible dead modules, exports, dependencies, stale comments,
  and unreachable branches. Static-analysis output is treated as a lead and
  every candidate is traced manually.
- Luna B reviews repeated leaf helpers, needless conversions, redundant state,
  and local control-flow complexity that can be simplified without changing an
  ownership boundary.
- Luna C reviews test helpers, obsolete fixtures, misleading test names, and
  cheap missing characterization around suspicious low-risk code.

Do not tune architecture metrics in this phase. In particular, the existing
architecture reporter's direction findings, browser-global observations,
cycles, and possible unused exports are not cleanup queues.

Acceptance: only deletions, local simplifications, clear naming corrections,
and tightly scoped characterization may land. No public contract or persisted
state shape changes.

## Phase 2: application shell and presentation

Review the main composition root, workspace, desktop components, mobile shell,
menus, window integration, and presentation-only helpers.

- Luna A follows application state and event flow through `App.svelte`, the
  main-window runtime/services, and workspace composition, looking for stale or
  duplicated projections and incorrect teardown.
- Luna B reviews desktop and mobile presentation for duplicated behavior,
  unreachable branches, event/listener leaks, and logic that accidentally
  diverges between the two shells.
- Luna C reviews window, popup, WCO, backdrop, artwork-presentation, and
  contextual-tab interactions for race conditions and locally confusing
  ownership.

Acceptance: components remain primarily presentation and dispatch surfaces.
Do not create a universal application view model or move every component import
behind a new facade merely to satisfy an import-direction rule.

## Phase 3: collections, files, metadata, and persistence

Review queue/library behavior, imports, managed folders, materialization,
metadata hydration, artwork caching, backups, IndexedDB, and file handles.

- Luna A traces queue and library mutation, selection, navigation,
  deduplication, hydration, and persistence scheduling for lost updates or
  duplicated ownership.
- Luna B traces file discovery, permissions, object URL lifetime, managed-folder
  reconciliation, and metadata work for stale jobs, leaks, and repeated reads.
- Luna C reviews persistence boundaries, backup/restore, artwork caching, error
  handling, and tests for data loss, accidental blob persistence, or silent
  fallback behavior.

Acceptance: preserve the documented storage boundaries, stable IDs, play
counts, queue/library distinction, and permission behavior. Do not introduce a
generic repository or IndexedDB framework. Current-version scorched-earth
compatibility remains the rule; do not add migrations without a separate
request.

## Phase 4: settings, Options, loadouts, and synchronization

Review lightweight persisted state and every Options consumer without turning
the settings surface into a generated system.

- Luna A traces representative settings from UI through normalization,
  persistence, BroadcastChannel delivery, duplicate suppression, and runtime
  application.
- Luna B reviews Options and mobile Options for disconnected controls, repeated
  editor behavior, accidental default/range disagreement, and presentation-only
  complexity.
- Luna C reviews loadout capture/application, per-track and folder matching,
  reset behavior, and cross-window convergence for stale or duplicated state.

Acceptance: preserve Goldilocks controls unless a separate product decision
removes one. Update `en.json` and `tr.json` for copy changes and never update
`en-askew.json`. Do not replace the focused stores with a universal settings
engine or schema registry.

## Phase 5: playback and audio

Review the highest-risk local subsystem only after the lower-risk phases have
established the review discipline.

- Luna A traces app-level play/load/seek/navigation sequencing, backend
  switching, transition cancellation, restoration, Media Session, and play
  counts.
- Luna B reviews Howler streams and native video, including media-element Web
  Audio routing, object lifetime, ReplayGain placement, fallback volume, and
  failure recovery.
- Luna C reviews OpenMPT, Hively, workers/worklets, the shared audio bus, Raf,
  analysers, and teardown for doubled audio, stale callbacks, and leaked audio
  resources.

Acceptance: preserve every playback path and the documented audio graph.
Backend-specific behavior may remain backend-specific. Do not impose a generic
player interface unless a concrete defect requires a small shared contract.
Playback edits require focused coverage for every affected backend, not only
the path where the issue was found.

## Phase 6: Multiplayer

Review Multiplayer as an experimental but internally coherent actor-like
system, with the host authoritative and Freeplay isolated from the host queue.

- Luna A reviews room/session lifecycle, signaling, peer/channel generations,
  reconnect behavior, protocol validation, and cleanup.
- Luna B reviews hosted source transfer, rendered audio, buffering, scheduling,
  memory/disk caches, receiver monitoring, and backpressure.
- Luna C reviews host projections, client controls, independent Freeplay
  renderers/timelines, persisted pair state, and authority violations.

Acceptance: preserve protocol/version coupling, signaling boundaries, the
pre-ReplayGain/pre-Raf stream tap, and per-pair Freeplay ownership. Avoid generic
actor frameworks, transport abstraction stacks, or compatibility adapters.
Cross-boundary findings require especially strong evidence and tests.

## Phase 7: tool windows and build/PWA integration

Review the separate tools and the infrastructure that makes every page work
offline and launch correctly.

- Luna A reviews Audio Compare, Editor, and Converter for duplicated media/job
  code, cancellation failures, worker/object URL leaks, and export correctness.
- Luna B reviews Troubadour, Troubadour Options, and Logs for staged-state
  confusion, unsafe writes/renames, cancellation, and accidental main-library
  mutation.
- Luna C reviews entrypoints, popup definitions, Vite inputs, navigation
  fallback denylisting, PWA registration/update behavior, file handlers, and
  worker/worklet emission for declaration drift.

Acceptance: tools retain their separate pages and domain ownership. Shared
metadata readers/writers may be consolidated only where existing behavior is
already identical. Build/PWA changes must consider offline caching, installed
launch, file handling, and libopenmpt asset emission together.

## Phase 8: convergence and stop decision

This is a review of the gardening edits, not permission for a final sweeping
refactor.

- Luna A reviews the complete gardening diff for regressions, unnecessary
  abstractions, and changes broader than their accepted findings.
- Luna B reviews test/build evidence and searches for behavior claims that were
  not actually verified.
- Luna C reviews the current tree for remaining high-confidence bugs or dead
  code that earlier phases missed, with the same five-finding cap.

The Sol owner reverts or narrows gardening changes that are not clearly paying
for themselves, runs the full relevant verification set, and produces the final
summary. Newly discovered cross-cutting redesign opportunities are recorded as
separate future proposals, not implemented here.

The pass stops when confirmed, proportionate findings are exhausted. It does
not continue until metrics are green, large files are split, cycles disappear,
or every subsystem conforms to one architectural vocabulary.

## Final deliverable

The final output is deliberately small:

- a ranked list of findings that were fixed;
- a short list of rejected or deferred findings with reasons;
- the commits or changed files for each phase;
- commands and outcomes for builds, checks, and focused/full tests;
- any residual manual browser/device checks;
- a brief assessment of whether another gardening pass would currently have a
  favorable risk-to-value ratio.

Do not grow this document into a source inventory, settings ledger, behavioral
bible, or replacement architecture specification. Durable project-wide rules
belong in `AGENTS.md`; implementation facts should remain discoverable from the
code and focused tests.
