# Hedge-trim pass (completed)

The hedge-trim pass is a deletion-led simplification of izci. It exists to
remove dead code, duplicated machinery, forwarding layers, unnecessary public
surface, and abstraction tax left by earlier file-splitting work. It is not a
feature pass, bug hunt, architecture migration, or another exercise in making
large files smaller by making the repository larger.

The completed gardening pass is retained as historical context in
[`gardening.md`](gardening.md) and
[`gardening-final-report.md`](gardening-final-report.md).

## Why this pass is different

The gardening series added 1,728 tracked lines: 1,194 test lines, 335
documentation lines, and 199 production lines. It fixed real defects, but its
operating rules explicitly treated line count as non-goal and sent each phase
searching for bugs that naturally required more coverage.

The larger simplification opportunity predates gardening. Three recent
file-splitting changes added 4,292 production lines in total:

- `c8e9576`, `Split up LoC offenders`: +2,170 production lines.
- `95d8b56`, `Refactor and modularize App.svelte`: +989 production lines.
- `6e79f8b`, `refactor: split LoC offenders into focused modules`: +1,133
  production lines.

Those changes created useful ownership boundaries, but also introduced context
objects, state mirrors, dependency bundles, forwarding APIs, duplicated type
surfaces, and one-consumer modules. The pass examines that tax directly. It
does not blindly revert the commits or rebuild their former monoliths.

## Outcome and accounting

Reduction is best-effort, not a fixed line quota. A numeric demand would invite
deleting useful tests, comments, documentation, or readable structure to make a
counter move. The Sol owner is nevertheless required to pursue all credible
reductions until the reviewed candidate ledger is exhausted; stopping after a
token dead-code sweep is not completion.

Accounting is reported separately for:

- production TypeScript, JavaScript, Svelte, and CSS under `src/`;
- tests;
- production module count and public exports;
- documentation, locale catalogs, vendored code, and generated output.

Documentation moves, test deletion, locale churn, vendor changes, and generated
output never count as production reduction. Existing assertions are not
deleted for the metric. Each accepted simplification must reduce production
code or remove a real module/public boundary; pure relocation is rejected. Each
phase must finish production-negative, and the complete pass must finish
negative even after proportionate test changes. If a candidate cannot meet
that gate without harming behavior or ownership, it is rejected or reverted.

Best-effort means all three phases run, all auditor findings receive a recorded
decision, all accepted candidates are carried through verification, and the
final convergence audit finds no remaining high-confidence in-scope cuts. It
does not mean “apply the first few easy deletions and stop.”

## Working model

Each phase has one GPT-5.6 Sol owner and exactly three GPT-5.6 Luna auditors.
The phases are deliberately broad so the auditors can trace systems rather than
returning three isolated nits.

Luna auditors work read-only. There is no arbitrary finding cap. Each auditor
owns a coherent slice and returns a ranked cut ledger containing:

- the exact code, callers, tests, and relevant history inspected;
- what can be deleted, collapsed, made private, or derived instead of stored;
- the concrete maintenance tax paid today;
- the smallest end state and an approximate before/after shape;
- behavior and ownership boundaries that must remain;
- verification that already covers the change and any genuine coverage gap;
- explicit “keep” decisions where an apparent abstraction earns its cost.

Speculation is labeled and is not an implementation candidate. File length,
cycles, import direction, or an analyzer warning is only a lead. Auditors must
trace dynamic imports, Svelte use, workers/worklets, build entrypoints, CSS
consumers, and test-only access before calling anything dead.

The Sol owner does not begin editing as soon as the reports arrive. It first:

1. Reads all three reports and constructs one deduplicated candidate ledger.
2. Independently verifies callers, runtime ownership, history, and existing
   tests for every plausible cut.
3. Sends targeted follow-ups to the auditors where evidence conflicts or a
   proposed boundary is unclear, then waits for those answers.
4. Records each candidate as accepted, rejected, or deferred with a reason and
   expected deletion mechanism.
5. Orders accepted work into independently revertible batches and only then
   starts editing.

There is no per-phase implementation cap. The owner continues until the
accepted ledger is empty, not until one refactor and two fixes have landed.
After implementation, the same auditors review the complete phase diff for
missed duplication, accidental behavior changes, metric gaming, and new
abstractions. The Sol owner independently verifies that second round and
narrows or reverts changes that did not pay for themselves.

## Phase 1: deadwood and repeated local machinery

This phase takes the broad, lower-risk cuts across the repository. It does not
change behavior or persistence shapes.

- Luna A audits dead modules, imports, exports, parameters, constants,
  functions, CSS selectors, stale feature branches, dependencies, and test-only
  production hooks. It begins with the architecture report and TypeScript
  unused diagnostics, then manually proves every candidate.
- Luna B audits repeated settings normalization, small store wrappers, Options
  plumbing, menu formatting/building, shared tool-window behavior, and exact
  CSS duplication. It may propose small reuse in an existing owner, but not a
  schema engine, registry, framework, or new abstraction stack.
- Luna C audits Track List, workspace presentation, mobile presentation,
  Editor, Converter, Logs, Audio Compare, and Troubadour for one-use helpers,
  duplicate adapters, superseded implementations, and split-era forwarding
  layers.

The Sol owner applies all confirmed local deletions and consolidations that pay
for themselves. Similar-looking code with meaningfully different behavior
stays separate. A shared helper is accepted only when its current consumers are
identical enough that the resulting tree is smaller and easier to trace.

## Phase 2: composition and split-tax reduction

This phase addresses the structural overhead created by the three historical
split commits while preserving the useful ownership boundaries established by
them.

- Luna A traces `App.svelte`, `main-window-runtime*`, main-window presentation,
  action/handler services, workspace controllers, and their state flow. It
  looks for duplicated defaults and mirrors, getter-of-getter dependencies,
  manually repeated action interfaces, redundant re-exports, and tiny bundles
  whose contract costs more than their behavior.
- Luna B traces the split Multiplayer host and client families, including
  channels, lifecycle, playback preparation, synchronization, and Freeplay. It
  identifies repeated context surfaces, pass-through functions, duplicated
  state access, and types exported only to support the split.
- Luna C traces the split Track List and Troubadour families plus menu items and
  stream metadata/artwork facades. It distinguishes cohesive parsing or job
  ownership from wrappers that merely relay arguments or preserve an
  unnecessary historical import surface.

The Sol owner simplifies total control flow and contract surface. It may merge
micro-modules or inline a one-consumer bundle when that removes machinery, but
must not recreate a giant `App.svelte`, player controller, Multiplayer actor,
or Troubadour component. Barrel exports and compatibility surfaces are removed
when the current tree does not need them; pre-alpha code does not preserve an
internal API for hypothetical consumers.

## Phase 3: high-risk trim and convergence

This phase handles the areas where deletion can disturb timing, resource
ownership, persistence, or multiple playback paths, then performs the final
whole-tree challenge.

- Luna A audits playback commands, player-controller coordination, Howler,
  OpenMPT, Hively, video, Media Session, the audio bus, Raf, and worklets for
  duplicate lifecycle state, obsolete fallbacks, redundant wrappers, and
  split-only contracts. Every proposed cut must account for all affected
  playback backends and the documented audio graph.
- Luna B audits queue/library persistence and hydration, artwork lifecycle,
  backups, File System Access flows, and cross-window settings synchronization
  for redundant copies, repeated normalization, and ownership indirection. It
  must preserve the documented persistence boundaries and retry/convergence
  behavior covered by gardening tests.
- Luna C audits the complete current tree and the accumulated hedge-trim diff.
  It challenges accepted and rejected decisions, searches for newly stranded
  code, checks whether any new helper merely moved complexity, and identifies
  remaining high-confidence cuts missed by the subsystem reviews.

After the Sol owner implements and verifies the accepted high-risk cuts, all
three auditors perform a final read-only convergence review of the entire pass.
The owner resolves every regression or unpaid abstraction by correction,
narrowing, or reversion. Newly discovered bugs that require additive feature
work are recorded separately rather than smuggled into this pass.

## Batch acceptance gate

Before changing a candidate, the Sol owner must be able to answer:

1. What exact code or contract disappears?
2. Which current callers and behaviors remain afterward?
3. Why is the proposed end state smaller in total rather than merely split
   differently?
4. Which existing tests establish the preserved behavior?
5. Does the change retain izci's playback, persistence, workspace, mobile,
   tool-window, PWA, and experimental ownership rules where applicable?

After every source batch:

1. Inspect production, test, module, and export deltas separately.
2. Narrow or revert a batch that is not production-negative or that creates a
   larger contract surface without removing a more expensive one.
3. Run the focused tests for the touched ownership area.
4. Run `npm run check` when relevant and the required `npm run build` after
   every source change.
5. Run `npm run multiplayer:protocol:check`, `npm run i18n:validate`, fixture
   tests, quality-tool tests, or Firebase rules tests when their areas change.

Test additions are allowed only for a real uncovered regression surface and
must remain proportionate to the code being removed. Prefer extending an
existing harness. A risky candidate whose safe deletion would require a new
miniature test environment can be deferred; it cannot be declared complete
merely because deletion is desirable.

## Completion

The pass completes only when:

- all three phases and both audit rounds have finished;
- every accepted candidate is implemented and verified;
- every rejected or deferred candidate has a concrete evidence-based reason;
- production and whole-tree accounting are negative without counting archived
  documentation, locale churn, vendor code, generated output, or sacrificed
  tests;
- `npm test`, `npm run check`, and `npm run build` pass, together with all
  relevant focused checks;
- the final convergence review finds no remaining high-confidence in-scope
  simplification that the owner has left unevaluated.

The final report stays concise: before/after accounting, the meaningful seams
removed, rejected/deferred candidates, verification results, and residual
manual checks. It does not become another long-lived source inventory.
