# Nukepass architecture reporter

Run the reporter from the repository root:

```sh
node scripts/nukepass/architecture/report.mjs --out /tmp/izci-architecture.json
```

Omit `--out` to write JSON to stdout. Use `--no-bundle` when no build artifact
facts are wanted. The reporter reads `dist/` when it exists but never creates or
changes it.

Mapped legacy findings remain informational, while reconstructed-surface
ratchets change the exit status. Enforced findings include import cycles,
browser capability access in kernel modules, direct storage/IndexedDB bypasses,
and configured import/source-path bans. Invalid configuration, an
unreadable/missing configured source root, parse failures, and output errors
also exit nonzero.

The Stage 2/3 ratchets keep contracts, logging, runtime, settings, persistence,
collection, media, inspection, and folder-planning kernels pointed toward leaf
contracts and ports. They also keep the Multiplayer protocol self-contained,
require media-source persistence to use the typed IndexedDB kernel, and reject
both unresolved imports of the deleted `$lib/types` barrel and restoration of
its old source path.

The analysis is deliberately bounded:

- imports cover ESM imports, re-exports, and string-literal dynamic imports;
- forbidden imports compare both literal specifiers and normalized internal
  target candidates, so a deleted target cannot evade enforcement by remaining
  unresolved;
- cycles are strongly connected components of resolved source-module edges;
- runtime sources include TS/Svelte/JS under `src/`, the root Vite, Svelte, and
  Sites Worker runtime/build configuration, and the executable Raf and AHX
  worklets copied from `public/`;
- sources are classified as browser, worker, Node-build, or vendor runtime;
  browser-capability violations apply to browser/worker sources, while Node and
  vendored observations remain separately visible rather than polluting that
  count;
- browser-global findings use lexical scopes (including destructuring) but are
  still syntax-based candidates, not type-checked ownership;
- possible unreferenced modules are production modules with no production
  inbound edge after declared entrypoints and test files are excluded; test-only
  importers and edge counts are retained on each candidate;
- possible unreferenced exports omit Svelte exports, entrypoints, modules with no
  inbound edge, and modules consumed through namespace or dynamic imports;
- bundle facts are exact file sizes plus the recognizable generated Workbox
  precache literal when a current `dist/` exists.

Run the synthetic-fixture tests with:

```sh
node --test scripts/nukepass/architecture/analyze.node-test.mjs
```
