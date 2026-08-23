# Gardening pass

The gardening pass is a bounded, evidence-led review of izci. Its purpose is
to remove defects and dead weight, consolidate accidental duplication, and
reshape awkward local structures without reconstructing the application or
imposing a new architecture.

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

Review may be broad, but implementation is deliberately capped. Each phase may
land one bounded refactor and up to two local fixes. A bounded refactor stays
inside one existing ownership area, is independently verifiable and revertible,
and does not introduce a new public contract, persistence shape, or platform.
Once that budget is spent, remaining findings are deferred; a phase need not
fill its budget.

## Rules for Luna auditors

Every Luna prompt must include these constraints:

- Work read-only. Do not modify the repository.
- Report no more than three findings, ordered by practical impact.
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
- Prefer direct simplification, focused extraction or consolidation, naming
  repair, race/leak fixes, and clearer control flow over infrastructure.
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
4. Does the correction materially simplify control flow, ownership, or future
   changes without adding disproportionate machinery?
5. What focused verification would fail before the correction or otherwise
   establish the intended invariant?

Reject recommendations whose main benefit is architectural purity, uniformity,
future flexibility, reduced line count, or movement behind another interface.
Two auditors noticing the same pattern increases review priority but does not
replace the Sol owner's verification.

Line count is a diagnostic, not an acceptance target. A refactor may grow the
tree when the result has fewer responsibilities, branches, duplicated workflows,
or ownership ambiguities. The phase report must explain material growth. Shared
helpers should serve current behavior rather than hypothetical reuse, and test
scaffolding should stay proportional: extend a nearby harness when practical
instead of building a new miniature environment for every guard.

## Completed phases

- Phase 1, low-risk debris and false signals: `a7f6f5a`.
- Phase 2, application shell and presentation: `a925038`.
- Phase 3, collections, files, metadata, and persistence: `636d5ad`.
- Phase 4, settings, Options, loadouts, and synchronization: `a8dc472`.
- Phase 5, playback and audio: `cacfea2`.
- Phase 6, Multiplayer: `d606dbe`.
- Phase 7, tool windows and build/PWA integration: `1ceb2c7`.
- Phase 8, convergence and stop decision: see
  [the final report](gardening-final-report.md).

Their implementation details and verification belong in the final phase report,
not in this operating guide.

## Phase 4: settings, Options, loadouts, and synchronization

Review representative high-risk settings and Options consumers without turning
the settings surface into a generated system or inventorying every control.

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
engine or schema registry. A bounded refactor may consolidate repeated
normalization, synchronization, or editor plumbing inside its current owner.

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
Keep refactors inside one backend or existing shared service. Changes crossing
the shared graph and multiple backends are deferred unless they correct a
confirmed playback defect. Playback edits require focused coverage for every
affected backend, not only the path where the issue was found.

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
Refactors stay within one protocol role or lifecycle owner. Cross-role and
protocol redesigns are deferred; confirmed cross-boundary defects require
especially strong evidence and tests.

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
launch, file handling, and libopenmpt asset emission together. Tool refactors
stay inside one tool; infrastructure work is limited to confirmed declaration
drift or launch/offline defects.

## Phase 8: convergence and stop decision

This is a review of the gardening edits, not permission for a final sweeping
refactor.

- Luna A reviews the complete gardening diff for regressions, unnecessary
  abstractions, and changes broader than their accepted findings.
- Luna B reviews test/build evidence and searches for behavior claims that were
  not actually verified.
- Luna C reviews the current tree for remaining high-confidence bugs or dead
  code that earlier phases missed, with the same three-finding cap.

The Sol owner reverts or narrows gardening changes that are not clearly paying
for themselves, runs the full relevant verification set, and produces the final
summary. Newly discovered cross-cutting redesign opportunities are recorded as
separate future proposals, not implemented here. Convergence does not start a
fresh implementation round.

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
