# Entrypoint, asset, and PWA registry

| Page | HTML and root | Popup defaults |
| --- | --- | --- |
| Main | `/index.html` -> `src/main.ts` | Main window |
| Options | `/options.html` -> `src/options/main.ts` | 680x460, scrollbars |
| Audio Compare | `/audio-compare.html` -> `src/tools/audio-compare/main.ts` | 1120x720 |
| Editor | `/editor.html` -> `src/tools/editor/main.ts` | 900x350 |
| Converter | `/converter.html` -> `src/tools/converter/main.ts` | 1120x720 |
| Logs | `/logs.html` -> `src/tools/logs/main.ts` | 1120x680 |
| Troubadour | `/troubadour.html` -> `src/tools/troubadour/main.ts` | 1280x820 |
| Troubadour Options | `/troubadour-options.html` -> `src/tools/troubadour-options/main.ts` | 760x560, scrollbars |

Vite inputs, popup definitions, and the seven non-main Workbox navigation
denylist paths currently agree but are hand-maintained independently. No
artifact test prevents drift. Every root registers the service worker only in a
production build and repeats some combination of theme, localization, logging,
scrollbar, popup-size and mobile-document bootstrapping.

## Runtime assets

| Asset | Build/runtime ownership |
| --- | --- |
| Converter worker | `converter.worker.ts`, per job, terminates on completion/error/abort |
| Editor module render worker | `module-render.worker.ts`, per render, terminates on completion/error/abort |
| Multiplayer render worker | `multiplayer-render.worker.ts`, reused by coordinator until clear/crash |
| Patched Chiptune loader | `src/lib/vendor/chiptune3/chiptune3.js`, bundled and coupled to the patched worklet |
| Chiptune worklet | Patched vendored `chiptune3.worklet.js`, hashed by Vite |
| libopenmpt worklet | Fixed `/assets/libopenmpt.worklet.js`, emitted unchanged for the worklet's relative import; dev vendor copy currently byte-identical |
| Hively | `/vendor/ahx-worklet.js` and `/vendor/hively-replay.wasm` |
| Raf | `/raf-upward-compressor.worklet.js` |
| Fonts/icons/licenses | Material Symbols WOFF2 plus static `public/` assets |
| PWA runtime | Generated `manifest.webmanifest`, `sw.js`, and `workbox-*.js` |

Stage 1 regenerates and records exact artifact names/hashes/sizes. The previous
`dist/` predates the checkpoint and is not baseline evidence.

The alternate `npm run sites:build` surface runs the production build and then
`prepare-sites-build.mjs`, moving client output below `dist/client/` and copying
`sites-worker.js` to `dist/server/index.js`. That worker serves assets, falls
back HTML 404s to the main index, and applies no-cache handling to the service
worker/manifest. It is a build/deployment entry, not a ninth UI page.

## PWA policy and current defects

Manifest facts are frozen in the checkpoint. Workbox precaches matching JS/CSS/
HTML/SVG/PNG/WOFF2/MEM/WASM/TXT assets below 4 MiB, ignores campaign/view query
parameters, and denies the seven tool/Options pages from main navigation
fallback. Hosting serves manifest/service worker without cache and otherwise
falls back to main index.

Open defects:

- `registerType: autoUpdate` emits immediate skip-waiting/claim behavior while
  UI code models a durable waiting worker and explicit restart decision.
- Manual update check can mark an update available and still show “up to date.”
- Each window owns independent check intervals/listeners/reload decisions; there
  is no cross-window coordinator or disposer.
- Explicitly included icons also match the glob and were duplicated in the old
  precache manifest.
- No online/offline/update/navigation or artifact assertion exists.

Stage 1's checked-in CDP harness opens the exact eight production pages and
captures actual service-worker/precache/browser evidence. Installed launch,
file handlers and WCO remain manual residuals.
