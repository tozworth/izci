# Architecture quality reporter

Run the reporter from the repository root:

```sh
node scripts/quality/architecture/report.mjs --out /tmp/izci-architecture.json
```

Omit `--out` to write JSON to stdout. Use `--no-bundle` when no build artifact
facts are wanted. The reporter reads `dist/` when it exists but never creates or
changes it.

Findings are informational. Import-direction findings, direct browser-
global candidates, cycles, and possible unreferenced exports do not change the
exit status. Invalid configuration, an unreadable/missing configured source
root, parse failures, and output errors exit nonzero.

The analysis is deliberately bounded:

- imports cover ESM imports, re-exports, and string-literal dynamic imports;
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
node --test scripts/quality/architecture/analyze.node-test.mjs
```
