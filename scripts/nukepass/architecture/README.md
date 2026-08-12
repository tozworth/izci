# Stage 1 architecture reporter

Run the reporter from the repository root:

```sh
node scripts/nukepass/architecture/report.mjs --out /tmp/izci-architecture.json
```

Omit `--out` to write JSON to stdout. Use `--no-bundle` when no build artifact
facts are wanted. The reporter reads `dist/` when it exists but never creates or
changes it.

Stage 1 findings are informational. Import-direction findings, direct browser-
global candidates, cycles, and possible unreferenced exports do not change the
exit status. Invalid configuration, an unreadable/missing configured source
root, parse failures, and output errors exit nonzero.

The analysis is deliberately bounded:

- imports cover ESM imports, re-exports, and string-literal dynamic imports;
- cycles are strongly connected components of resolved source-module edges;
- browser-global findings are lexical candidates, not type-checked ownership;
- possible unreferenced exports omit Svelte exports, entrypoints, modules with no
  inbound edge, and modules consumed through namespace or dynamic imports;
- bundle facts are exact file sizes plus the recognizable generated Workbox
  precache literal when a current `dist/` exists.

Run the synthetic-fixture tests with:

```sh
node --test scripts/nukepass/architecture/analyze.node-test.mjs
```
