# Stage 1 execution plan and ownership

Stage 1 starts from clean branch commit `57361c0` on `nukepass`. Its purpose is
to freeze observable behavior and establish verification infrastructure; it
does not begin the Stage 2 architecture replacement.

## Ordered slices and commit invariants

1. Record the reproducible clean-install baseline, including deterministic,
   Firebase-emulator, build, artifact, precache, and browser-startup evidence.
2. Establish the deterministic fixture corpus and generator contract.
3. Characterize orchestration boundaries in independently reviewable groups:
   playback/transition supersession; collection hydration, permission, and
   reconciliation; settings collisions; tool cancellation and PWA update
   decisions; Multiplayer generation replacement.
4. Report current dependency direction, browser-global access, cycles, unused
   code, coverage, and bundle facts without failing mapped baseline defects.
5. Launch every production page through disposable raw-CDP profiles, collect
   console/runtime/network/DOM/screenshot/trace evidence, and emit structured
   results.
6. Run the full gate from the assembled tree, perform adversarial review, repair
   findings as focused commits, and record Stage 1 acceptance.

No slice may create a production-only alternate business path. Test seams stay
at browser capability boundaries. Architecture findings are informational in
this stage and become ratcheted errors only as later stages reconstruct owners.

## Wave 1 ownership ledger

| Lane | Writable surface | Consumes but may not change | Integration order |
| --- | --- | --- | --- |
| Integration/director | `package.json`, lockfile, `docs/nukepass/stage-1/`, shared scripts, final test integration | All production contracts | Serial owner of shared surfaces |
| Characterization | Focused existing/new `*.test.ts` files and test-only helpers agreed before edits | Playback, collection, settings, PWA, tool, and Multiplayer production APIs | After baseline evidence |
| Fixture corpus | `fixtures/`, fixture-only generators/tests, fixture manifest draft | Canonical format policy | Before browser scenarios |
| Architecture reporting | `scripts/nukepass/architecture/` and focused reporter tests | Stage 0 dependency map and production imports | After baseline, before acceptance |
| CDP harness | `scripts/nukepass/cdp/` and harness tests/docs | Built entrypoints and production pages | After fixture contract; shared script/package edits integrated serially |

`App.svelte`, `src/lib/types.ts`, localization catalogs, Vite configuration,
Multiplayer protocol/rules, and generated shared artifacts are frozen integration
surfaces. Parallel lanes do not edit them. Agents do not commit independently;
the director reviews and commits each invariant from a clean shared index.

## Evidence and stop rules

Every source-changing commit receives focused tests and `npm run build`, with a
non-writing Multiplayer protocol check first when applicable. Any behavior
change, unexplained runtime error, stale build/service worker, unowned stale
event, or collision on a frozen surface stops integration until its owner and
expected behavior are explicit.

The browser lane may start only the production preview/static fixture server and
browser children required by the Stage 1 gate. It uses temporary profiles and
ports, never a developer profile or assumed port. Installed-PWA, file-handler,
Window Controls Overlay, real picker, physical-audio, Android, and real-network
claims remain residual manual/device checks.
