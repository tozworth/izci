# Bundle and cleanup pass

A generalized, repeatable code cleanup/improvement pass driven by subagent
delegation. Primary motivator: the production build now trips the 500 kB
post-minification chunk warning. Secondary motivator: several source files have
grown into monoliths that make every future change slower and riskier.

The pass is split into four phases: instrumentation, a low-risk hygiene batch,
a decomposition batch, and measurement-driven bundle engineering. Each phase
ends at a verification gate; the orchestrator (the main agent session) is the
only actor that commits, merges, and touches build config.

## Measured baseline (at plan time)

### Bundle

`npm run build` output (minified / gzip):

| Chunk | Minified | Gzip |
|---|---|---|
| main-*.js (entry) | **562.48 kB** | 163.93 kB |
| index-*.js (shared vendor) | 296.81 kB | 102.82 kB |
| OptionsApp | 255.72 kB | 71.66 kB |
| troubadour | 148.74 kB | 46.10 kB |
| index.esm x2 (firebase, already lazy) | 144.47 / 128.87 kB | 42.14 / 36.54 kB |
| mediabunny-flac-encoder (already lazy) | 322.52 kB | 83.02 kB |
| id3 (already lazy) | 311.46 kB | 81.26 kB |
| mediabunny-mp3-encoder (already lazy) | 311.04 kB | 131.53 kB |
| output (worker) | 115.15 kB | 29.69 kB |
| custom-coder | 90.40 kB | 22.19 kB |
| editor / converter / audioCompare / mobile-options / loadout-presentation | 69.16 / 52.05 / 44.87 / 43.00 / 49.14 kB | ~15-20 kB each |

- Only `main-*.js` exceeds the warning threshold (562.48 kB > 500 kB).
- PWA precache: 91 entries, 7,827.65 KiB total.
- The heavy third-party leaves (firebase, mediabunny encoders, id3) are already
  code-split. The main chunk is dominated by first-party code: `App.svelte`
  statically imports ~40 services, and the app itself is 85,360 lines across
  463 files.

### Source inventory

- 463 source files (ts + svelte), 85,360 lines, 136 test files (`.test.ts`,
  colocated).
- Per-area: services 202 files / 37,829 lines; components 61 / 14,501; tools
  78 / 13,547; options 32 / 6,698; stores 56 / 7,042; mobile 10 / 1,233.
- Largest files: `App.svelte` 2,485; `multiplayer-host.ts` 1,700;
  `multiplayer-client.ts` 1,441; `PlaylistPanel.svelte` 1,354;
  `TroubadourApp.svelte` 1,271; `stream-artwork.ts` 1,228;
  `troubadour-controller.ts` 1,107; `LoadoutsView.svelte` 945;
  `AudioCompareApp.svelte` 944; `PlayerControls.svelte` 935;
  `EditorApp.svelte` 889; `LyricsPanel.svelte` 888; `workspace-shell.ts` 876;
  `multiplayer-render-playback.ts` 869; `TopMenuBar.svelte` 764;
  `backups.ts` 748; `player-controller.ts` 704.
- Green tree at plan time: `npm run check` 0 errors / 0 warnings;
  `npm run i18n:validate` passes; `npm run build` succeeds (with the warning).
- Already-lazy patterns to extend, not duplicate: OptionsApp via
  `{#await import(...)}` (`App.svelte:2476`), firebase via a loader in
  `multiplayer-signaling.ts`, mediabunny encoders in `clip-export.ts` /
  `converter-engine.ts`, mediabunny in `lyrics.ts:227`.

## Goals

1. Get every chunk under 500 kB post-minification; stretch goal for the entry
   chunk: <= 450 kB minified (<= 150 kB gzip), measured by the phase-0 report
   script.
2. Decompose the five worst monoliths so ownership boundaries are visible and
   future lazy-loading is possible.
3. Leave reusable tooling behind (bundle report script, dead-code/import
   checks) so the pass can be re-run cheaply next time the graph grows.
4. Zero behavior change: playback paths, persistence boundaries, UI behavior,
   and i18n catalogs are byte-identical in effect.

## Non-goals

- No new features, no UX changes, no theme/layout changes.
- No legacy migrations or adapter shims (project policy: scorched-earth).
- No "modernization" drive-bys: Svelte 5 legacy reactive statements stay
  legacy; `on:event` vs `onevent` conventions are preserved as-is.
- **Raising `chunkSizeWarningLimit` is not a fix and is forbidden** in this
  pass.
- No dependency swaps (e.g. replacing howler/mediabunny) unless a measurement
  in phase 3 shows a clear, revertible win.

## Hard constraints (from AGENTS.md and skills)

- Preserve all playback paths: streamed audio via Howler HTML5, modules via
  Chiptune3/libopenmpt worklet, videos via native element into the shared Web
  Audio graph.
- Preserve persistence boundaries: IndexedDB for collections/handles/artwork
  cache, localStorage for UI state, BroadcastChannel for sync. Never persist
  lyrics, meters, or transient presentation state.
- Business logic stays in services/stores; components render and dispatch.
- i18n: any copy change touches both `en.json` and `tr.json`; never
  `en-askew.json`. Run `npm run i18n:validate`.
- `npm run build` (which runs the protocol sync prebuild) after every source
  change. No dev/preview servers, no browsers (multiplayer verification is
  headless-only via the skill's `rig-headless-pass.py`).
- Keep code comments short and direct; the full story lives in skills.
- When sweeping comments, follow `code-comment-hygiene` (content-based
  replacements, migrate new knowledge to skills first, verify zero non-comment
  lines changed).

## Delegation model

The pass is executed by the orchestrator dispatching **leaf agents** — no
nested delegation (this environment is one level deep, max 3 concurrent
leaves). Parallelism therefore means batches of up to 3 workstreams; batches
run sequentially, phases run sequentially.

### Flow per batch

```
orchestrator
  ├─ dispatch W1 ── leaf agent (own terminal, own file fence)
  ├─ dispatch W2 ── leaf agent
  └─ dispatch W3 ── leaf agent
        │  (all three run concurrently, each: skill_view → read scope →
        │   edit → focused tests → npm run build → structured report)
        ▼
orchestrator: verify self-reports (git diff --stat, spot-read diffs, grep for
fence violations) → run the master gate → fix or bounce back → commit phase
```

### File fences

- Each leaf gets an explicit allowed-file list (its workstream scope) and a
  read-only list (files it may read but never edit).
- The following are **orchestrator-owned** and off-limits to all leaves:
  `vite.config.ts`, `package.json`, `package-lock.json`, `tsconfig.json`,
  `scripts/`, `docs/`, `public/`, `dist/`, `dev-dist/`.
- No two leaves in the same batch may share an allowed file. If a workstream
  wants to create a new file (extraction target), it must be inside its own
  allowed directory and reported in the schema's `created_files`.
- Leaves never commit, never push, never rebase. They leave working-tree
  changes for the orchestrator to review and commit at the gate.

### Leaf contract (context payload)

Every delegation `context` must contain, self-contained:

1. Repo facts: cwd `/home/toz/Projects/izci`, branch, `$lib` alias, prebuild
   behavior, the fact that `npm run build` also validates protocol sync.
2. Which skills to load first (`skill_view`) and treat as source of truth:
   `izci-ui-development` always; `code-comment-hygiene` for W1;
   `izci-logging-development` for W3; `izci-multiplayer-development` for D2.
3. The exact allowed/read-only file lists.
4. The workstream's acceptance criteria (below).
5. The verification chain and the required output schema.
6. Style: terse comments, no drive-by edits, match surrounding conventions.
7. Explicit prohibitions: no commits, no servers/browsers, no touching
   orchestrator-owned files, no `chunkSizeWarningLimit`, no en-askew.json.

### Output schema (JSON, required)

```json
{
  "workstream": "w1-comments",
  "changed_files": ["path"],
  "created_files": ["path"],
  "deleted_files": ["path"],
  "findings": ["notable discoveries for the orchestrator"],
  "verification": {
    "check": "pass|fail",
    "tests": {"ran": 0, "passed": 0, "skipped": 0},
    "build": "pass|fail",
    "diff_check": "pass|fail"
  },
  "unexpected": ["anything outside scope that changed"]
}
```

### Self-report verification (mandatory)

Child summaries are self-reports, not facts. The orchestrator must, for every
leaf:

- `git diff --stat` and `git status` — confirm only allowed files changed.
- Spot-read the actual diffs of the 3-5 largest touched files.
- Grep for fence violations (`git diff --name-only | grep -v allowed`).
- Re-run the master gate itself (below), never trusting the leaf's `pass`.

## Master gate (run by the orchestrator after every batch)

```text
npm run check
npm run test
npm run i18n:validate
npm run multiplayer:protocol:check
npm run build
git diff --check
```

For any phase touching multiplayer (D2, and any phase-3 candidate that touches
its import graph): also run the headless multiplayer rig from the
`izci-multiplayer-development` skill (`rig-headless-pass.py`, Playwright
Chromium, no DISPLAY). Never launch visible Helium instances for this.

The bundle report script (phase 0) runs after every batch and its numbers are
appended to this doc.

## Phase 0 — Instrumentation (orchestrator only, no delegation)

1. Add `scripts/bundle-report.mjs`: runs `npm run build`, parses the rollup
   chunk table, emits `docs/bundle-report.md` (chunk, minified, gzip, flag any
   chunk > 500 kB) plus the precache total. Zero new dependencies, mirroring
   the existing `scripts/*.mjs` tooling style.
2. Optionally add `rollup-plugin-visualizer` as a devDependency and wire it
   behind an env flag (`REPORT=1 npm run build`) for interactive chunk
   inspection; the report script remains the canonical gate.
3. Record the baseline table above into the report doc and commit.
4. Add a `scripts/tsc-strict.mjs`-style one-off check (or a `tsc --noEmit`
   invocation with `noUnusedLocals`/`noUnusedParameters`) as the dead-import
   detector for W2. `svelte-check` alone does not flag unused locals the same
   way; there is no eslint in this repo and adding one is out of scope.

Gate: report script reproduces the baseline numbers above.

## Phase 1 — Hygiene batch (3 parallel leaves)

### W1 — Comment hygiene sweep

- Scope: all of `src/` (`*.ts`, `*.svelte`), excluding `src/lib/vendor/`.
- Load `code-comment-hygiene` first. Classify every comment block NUKE /
  TIGHTEN / KEEP against the project's standard (load-bearing "why" only,
  1-3 lines). Migrate any knowledge not already in skills into the relevant
  skill BEFORE editing code.
- Use content-based replacements (the skill's sweep script); verify
  `count==1` before each replace; re-indent replacements to the original
  block.
- Acceptance: `git diff` shows only comment lines changed (skill's grep
  chain → 0 non-comment lines); zero behavior change; build green.
- Verification: skill chain + `npm run check` + build.

### W2 — Import hygiene and dead code

- Scope: all of `src/` (read: `types.ts`, `files.ts` and the i18n catalogs to
  understand extension/kind and key rules).
- Convert runtime imports used only for types to `import type` (the existing
  code already does this in places — extend the pattern). Remove unused
  imports and unused exports flagged by the phase-0 `tsc` detector; keep
  public store/service facades intact (`playlist.ts` remains the public
  facade; do not prune exports reachable from `App.svelte` or tool entry
  points).
- Report genuinely unreachable modules in `findings` for the orchestrator to
  confirm deletion in phase 3 (never delete a module based on a single grep).
- Acceptance: `npm run check` 0/0, type-check detector clean, build green,
  no runtime import removed.
- Verification: check + focused tests + build.

### W3 — Logging hygiene

- Scope: `src/lib/services/logging.ts` and every `log()` / `logError()` call
  site (mainly under `src/lib/services/`, `src/tools/`).
- Load `izci-logging-development` first. Consolidate duplicate/near-duplicate
  messages, drop transient debug spam that has outlived its investigation,
  keep typed levels/sources, keep the in-memory ring buffer transient (never
  persisted).
- Acceptance: no persisted-logging changes; message count per source reduced
  or flat; no log line references stale identifiers.
- Verification: logging-focused tests (`logging.test.ts`,
  `logging-sync.test.ts`) + check + build.

Gate: master gate passes; phase-1 diff is comments/imports/logging only.

## Phase 2 — Decomposition batch (3 parallel leaves)

Decomposition is primarily a maintainability win; byte wins arrive in phase 3
once the graph is cleaner. Each leaf splits one monolith into cohesive
modules, keeping public facades and test surfaces identical.

### D1 — `App.svelte` (2,485 lines)

- Scope: `src/App.svelte` only (extraction targets may be created under
  `src/lib/services/` and `src/lib/components/workspace/`).
- Split the composition root: controller-wiring blocks move into service
  factories or a new `src/lib/services/app-runtime.ts`; only lean component
  composition and event dispatch stay in the file. Target <= 600 lines.
- Rare-flow message responders (e.g. `troubadour-sync` handlers, tool
  window sizing) should become lazy at their call sites (dynamic `import()`
  inside the handler) IF that does not delay their first possible use — flag
  each lazy candidate in `findings` with its expected chunk impact; do not
  rewire module-level wiring to lazy without orchestrator sign-off.
- Acceptance: same imported surface, zero behavior change, build green.
- Verification: check + build + spot diff; re-read the file top to bottom.

### D2 — Multiplayer monoliths

- Scope: `src/lib/services/multiplayer-host.ts` (1,700) and
  `src/lib/services/multiplayer-client.ts` (1,441); extraction targets under
  `src/lib/services/multiplayer-*/`.
- Load `izci-multiplayer-development` first. Extract cohesive closures into
  sibling modules following the existing ownership map (session, render,
  transfer, sync, peer). Keep `multiplayer-session.ts` wiring and
  `multiplayer-protocol.ts` contracts untouched. Do not change any wire
  message, protocol version, or Firebase rule.
- Acceptance: all multiplayer tests pass unchanged; protocol check passes;
  headless rig passes.
- Verification: full multiplayer test set + `multiplayer:protocol:check` +
  headless rig + build.

### D3 — `stream-artwork.ts` (1,228)

- Scope: `src/lib/services/stream-artwork.ts` plus its extraction targets
  under `src/lib/services/`; read `artwork-cache.ts`, `artwork-palette.ts`,
  `artwork-presentation.ts` to find the real boundaries.
- Split loading, caching, palette analysis, and presentation side effects
  along the existing service boundaries; keep the public functions imported by
  `App.svelte` (`loadTrackArtwork`, `getTrackArtworkLoadKey`, ...) stable.
- Acceptance: artwork tests pass; no artwork blob ever lands in playlist or
  library records; cache stays bounded and rebuildable.
- Verification: artwork-focused tests (`stream-artwork.test.ts`,
  `artwork-cache.test.ts`, `artwork-presentation.test.ts`,
  `album-artwork.test.ts`) + check + build.

Gate: master gate passes; bundle report re-run (expect small entry-chunk
movement only).

## Phase 3 — Bundle engineering (orchestrator-owned)

Now the graph is clean enough to measure precisely. Each candidate follows a
**measure → implement → measure → accept-or-revert** loop with the phase-0
report script; nothing is accepted without a measured improvement.

### Candidate moves (verify each with the report script)

1. **Lazy rare-flow services statically imported by `App.svelte`**: candidates
   from D1's findings, plus `window-now-playing`, `window-video`, `file-launch`
   if their startup use can be deferred or their handlers made lazy. Move
   heavy service chains (e.g. `troubadour-sync` → `media-metadata/*`) behind
   `import()` at the first actual use.
2. **Lazy the Patterns workspace tab**: niche dockable tab; dynamic component
   + `import()` keeps the first open snappy (chunk is cached after first
   open). Leave Lyrics/Playlist/Library/Now Playing static — they are core.
3. **`manualChunks` vendor split**: svelte runtime + svelte-i18n + howler +
   fflate into a stable `vendor` chunk so the entry chunk reflects first-party
   size and vendor hashes stop churning. Validate against PWA precache size
   and SW update behavior; verify installed-launch and file-handler paths per
   the change checklist.
4. **Re-audit mediabunny/id3 boundaries**: confirm `media-metadata/reader`
   and `lyrics.ts` keep mediabunny lazy; if any static import crept in, make
   it dynamic. Do not bundle mediabunny into the entry graph.
5. **Anything the report script flags**: e.g. accidental re-entry of a heavy
   chunk into main, duplicate module copies (same source in two chunks), or a
   module > 50 kB that is reachable only from a rare flow.

### Targets

- No chunk > 500 kB post-minification (warning gone).
- Entry chunk <= 450 kB minified, <= 150 kB gzip.
- Precache total below the measured 7,827.65 KiB baseline (or flat, if vendor
  split adds duplicate copies — then revert the split and keep lazy moves).

One leaf agent may be used for a "candidate exploration" pass (read-only:
report script + import-graph greps + ranked candidate list with expected
deltas), but all config edits (`vite.config.ts`, `package.json`) are made by
the orchestrator.

## Phase 4 — Regression gate and re-baseline

1. Full master gate (all 5 commands) plus the headless multiplayer rig if any
   multiplayer-adjacent module moved.
2. Re-run the bundle report; update `docs/bundle-report.md` and the baseline
   table at the top of this doc with before/after numbers.
3. Commit phase by phase with descriptive messages; never squash the whole
   pass into one commit.
4. Update skills where the pass revealed missing knowledge (AGENTS.md rule:
   patch skills immediately when found stale).

## Definition of done

- Warning gone: no chunk exceeds 500 kB; entry <= 450 kB minified.
- `npm run check` 0 errors / 0 warnings; full `npm run test` green;
  `npm run i18n:validate` green; `npm run multiplayer:protocol:check` green;
  `npm run build` green; `git diff --check` clean.
- Headless multiplayer rig green if multiplayer graph moved.
- Bundle report script committed and re-runnable; baseline table updated.
- Zero behavior change: no persistence/layout/playback/i18n-catalog diffs
  beyond copy changes paired in `en.json`+`tr.json`.

## Risks and pitfalls

- **Comment sweep line/indent hazards**: line-number-based old strings shift;
  JSON round-trip loses indent. Use the skill's content-based, count-verified
  replacements only.
- **Parallel edits must not overlap**: the file fence is the only thing
  preventing merge pain; a fence violation is a batch-level failure, not a
  per-file one — the orchestrator greps `git diff --name-only` against allowed
  lists before any merge.
- **Self-reported success is not success**: every leaf's `pass` is re-verified
  by the orchestrator at the master gate.
- **Lazy-loading regressions**: a lazy boundary that runs on a hot path
  (startup, tab switch) hurts UX even if bytes drop. Only lazy what is truly
  rare; test the first-open path.
- **PWA side effects**: chunk renames/renumbering interact with precache and
  SW updates; `maximumFileSizeToCacheInBytes` (4 MB) must not be exceeded by
  any new chunk. Re-run `npm run build` and check the precache table.
- **Multiplayer fragility**: never touch protocol contracts, version numbers,
  or Firebase rules; the headless rig is the only accepted multiplayer
  verification.
- **i18n drift**: copy edits must land in both catalogs; `en-askew.json` is
  untouchable.
- **Do not** bump `chunkSizeWarningLimit`, add migrations, or convert
  legacy Svelte reactive statements as a drive-by.

## Re-running this pass (generalization)

The pass is designed to be re-run whenever the warning returns or the graph
creeps again:

1. Run `scripts/bundle-report.mjs`; compare against `docs/bundle-report.md`.
2. If a chunk crossed 500 kB: repeat phase 3's candidate loop first (cheapest
   wins), then phase 2 decomposition only for files that grew past ~1,000
   lines, then phase 1 hygiene as a periodic low-risk batch.
3. If files crossed ~1,000 lines without crossing the chunk budget: run the
   phase 2 batch alone.
4. If only comment/import clutter accumulated: run the phase 1 batch alone.

The three phase-1 workstreams double as the standing "quarterly cleanup" batch
and can be re-dispatched as-is; only the file fences and the baseline numbers
need refreshing.
