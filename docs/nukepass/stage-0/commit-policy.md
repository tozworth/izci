# Nukepass commit policy

Every commit must establish one named invariant, complete one vertical cutover,
or record one independently reproducible evidence checkpoint.

Accepted subjects describe the result, for example:

- `Freeze the nukepass recovery checkpoint`
- `Inventory persisted state and cache ownership`
- `Characterize playback command supersession`
- `Launch every built page through disposable CDP profiles`

Subjects such as `cleanup`, `misc fixes`, `attempt 2`, or a stage number without
an invariant are rejected. Mechanical formatting or generated output does not
share a commit with a behavioral or architectural change unless generation is
the invariant under test.

Before each commit:

1. Confirm the diff contains only its named slice and does not absorb unrelated
   user work.
2. Run the domain-focused test/check required by the runbook.
3. After any source change, run `npm run build`; first run
   `npm run multiplayer:protocol:check` if protocol-sensitive files could make
   prebuild rewrite Firebase rules.
4. Record notable warnings, skips, browser evidence, and residual risk in the
   appropriate stage evidence file.
5. Delete a replaced path in the same accepted stage; a compiling shadow path is
   not a completed cutover.

Shared contracts, `App.svelte`, `src/lib/types.ts`, localization catalogs,
Multiplayer protocol, and `vite.config.ts` are serialized integration surfaces.
Parallel work uses disjoint files or read-only surveys until their contracts are
frozen.
