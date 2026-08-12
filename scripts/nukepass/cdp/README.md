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

Each run records the exact commit, content-addressed build manifest, seed,
browser/OS/Node identity, flags, dynamic ports, process logs, target failures,
and the checked-in `scenarios.json` catalog plus per-page results. Each of the
eight production entrypoints produces a PNG,
DOM snapshot, console/runtime/log/network record, service-worker state,
performance metrics, DOM/resource counters, and heap-usage snapshot. A browser
trace and full V8 heap snapshot are written for each profile. Unexpected
navigation, target loss, runtime
exceptions, console/log errors, non-cancelled network failures, readiness
timeouts, and trace loss fail closed.

Stage 1 boot scenarios record the fixture-manifest digest but explicitly mark
the fixture corpus unused. This avoids claiming media-path coverage from page
boot. Later fixture-driven scenarios switch that catalog fact to true.

The current Stage 1 scenario is boot characterization. Later stages add media,
fixture-handle, persistence, PWA-update, Multiplayer, interaction, full-heap,
and leak scenarios without replacing this launcher/report contract. The harness
does not certify installed-PWA launch, native pickers, file handlers, Window
Controls Overlay, physical audio, Android interaction, or real network paths.
