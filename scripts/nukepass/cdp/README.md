# Stage 1 CDP characterization harness

The harness launches the production build in one to three fresh Chromium-family
profiles. It allocates the HTTP and DevTools ports dynamically, reads
`DevToolsActivePort`, uses raw flattened CDP sessions, and never touches a
developer profile.

Prerequisites are Node 22+, `npm run build`, and a Chromium-family executable.
For the current workstation baseline:

```sh
node scripts/nukepass/cdp/run.mjs --browser /opt/apps/Helium.AppImage
```

Use `--out`, `--profiles 1..3`, `--windows-per-profile 1..3`, `--seed`, and
profile-retention flags as shown by `--help`. The window option opens concurrent
targets in one profile for BroadcastChannel and multi-window characterization.
Reports are written below ignored `artifacts/cdp/` by default.

Each run rejects a dirty or mismatched build-provenance marker, then records the
exact commit, content-addressed build manifest, seed,
browser/OS/Node identity, flags, dynamic ports, process logs, target failures,
and the checked-in `scenarios.json` catalog plus per-page results. Each of the
eight production entrypoints produces a PNG,
DOM snapshot, console/runtime/log/network record, service-worker state,
performance metrics, DOM/resource counters, heap usage, and a full V8 heap
snapshot from that application target. A browser trace is written for each
profile. Unexpected
navigation, target loss, runtime
exceptions, console/log errors, non-cancelled network failures, readiness
timeouts, and trace loss fail closed.

The harness auto-attaches to service workers, dedicated/shared workers, and
worklet targets exposed by CDP. It pauses each owned background target until
console/exception/log listeners and protocol domains are active, then records
its output and detach state separately from page sessions. It proves that the server's
`/sw.js` bytes match the build and that a fresh profile reaches a settled active
registration. It does not claim to hash the private bytes of an already-active
worker; seeded old-worker update behavior remains a later PWA scenario.

Infrastructure and cleanup failures also produce `report.json` and a failing
summary. A build made while source edits are uncommitted deliberately records
`dirty: true`; rebuild once the tree is clean at HEAD before an acceptance run.

Stage 1 boot scenarios record the fixture-manifest digest but explicitly mark
the fixture corpus unused. This avoids claiming media-path coverage from page
boot. Later fixture-driven scenarios switch that catalog fact to true.

The current Stage 1 scenario is boot characterization. Later stages add media,
fixture-handle, persistence, PWA-update, Multiplayer, interaction, full-heap,
and leak scenarios without replacing this launcher/report contract. The harness
does not certify installed-PWA launch, native pickers, file handlers, Window
Controls Overlay, physical audio, Android interaction, or real network paths.
