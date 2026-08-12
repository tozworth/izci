# Stage 1 settings registry reporter

Run from the repository root:

```sh
node scripts/nukepass/settings/report.mjs --out /tmp/izci-settings.json
```

The deterministic JSON report compares statically discoverable persistent-store
defaults (including configured direct-localStorage Converter settings) with the
checked-in Stage 0 setting-ledger identities. For each declared field it reports
Svelte presentation references, non-test TypeScript/JavaScript runtime
references, test references, ledger match confidence, and an informational
connection classification independently from ledger mapping status. It also
retains ledger rows that do not map to a discovered
default and rows explicitly documenting a disconnected setting.

This is a bounded registry cross-check, not semantic reachability analysis:

- dynamic/generated default shapes, record keys, array element schemas, IDB
  state, and direct storage not listed in the config may remain one leaf or be
  absent;
- identifier presence can over-count unrelated names and cannot prove that a UI
  change reaches a live runtime owner;
- Svelte files count as presentation; non-test sources, including Svelte
  application/tool roots, also count as runtime unless they are under the
  configured Options-only surfaces; references inside a setting's
  declaration/default files are removed;
- ledger matching uses exact identity, then suffix, then a globally unique leaf;
- every omission/disconnection remains informational in Stage 1. Only config,
  input, parse, reporter, or output errors exit nonzero.

Focused tests:

```sh
node --test scripts/nukepass/settings/analyze.node-test.mjs
```
