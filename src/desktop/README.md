# Windows desktop MVP

Build with `npm run desktop:build`. The runnable output is
`.local/desktop/izci.exe`; this is the only app file needed for distribution.
After compilation, verification and packing succeed, the build script closes
the running workspace copy (including `.local/desktop-next/izci.exe` from an
earlier build), atomically replaces the output, and relaunches it. Playback
continues during the build. Shutdown first requests a normal close to save
window placement, then force-terminates after 1.5 seconds if necessary. A failed
replacement relaunches the previous copy. Other executable paths are untouched;
building while no local player is running does not launch one.
The MSVC build statically links the WebView2 loader and Visual C++ runtime, so
there is no `WebView2Loader.dll` sidecar. An installed Evergreen WebView2 runtime
is still required. Build dependencies are the Rust MSVC toolchain
(`rustup toolchain install stable-x86_64-pc-windows-msvc`) and Microsoft C++ Build
Tools with the Desktop development with C++ workload. The build script defaults
to `stable-x86_64-pc-windows-msvc`, honors an MSVC `RUSTUP_TOOLCHAIN` override,
and recognizes workspace-local Rust under `.local/desktop-toolchain/`.

Ordinary `desktop:build` builds omit the embedded signaling server, do not read
or build `izci-server/`, and do not require Go. They use the previous browser
HTTP/WebSocket transport for external signaling, with no native signaling
dependencies.

To include built-in signaling, run `npm run desktop:build:signaling` (equivalently,
`npm run desktop:build -- --with-signaling`). This variant publishes to
`.local/desktop-signaling/izci.exe`, leaving `.local/desktop/izci.exe` untouched.
Publication only closes and relaunches the matching variant; the regular build
also handles its older `.local/desktop-next/izci.exe` fallback.
`--no-compress` works with either variant. The signaling build enables
Cargo's opt-in `builtin-signaling` feature, synchronizes the Go app protocol,
and requires the Go version declared in `izci-server/go.mod`. Cargo builds
`cmd/izci-desktop-signal` with CGO disabled and embeds the stripped Windows binary
into izci.exe. There is no distributed sidecar, Go runtime,
dedicated host, database, decoder, or renderer in this signaling target.

In signaling-enabled builds, Multiplayer > Hosting defaults to **Built-in server**,
with **External signaling** in the same dropdown. Host starts one app-owned room without an operator key,
then opens the party/invitation dialog. Joining always uses the invitation's
endpoint, independently of this hosting preference. Signaling-enabled builds use
narrow native HTTP/WebSocket commands for plain HTTP/LAN endpoints; WebView
security flags stay intact. Ordinary builds need HTTPS
for non-loopback endpoints, as browser clients do.
Invitations use the public izci web origin rather than the local Tauri origin
and can be pasted into another izci.exe. Browser clients need an HTTPS endpoint
(a reverse proxy or external signaling); custom browser origins can be allowed
in Hosting's advanced tweaks.

The built-in listener binds IPv4 interfaces on the configured TCP port (8787
by default). Invitation addresses default to a LAN address, or the router's
public address when **Map signaling port with UPnP** succeeds. An advertised
address override supports port forwarding and HTTPS reverse proxies; the party
dialog can choose a LAN address when a router lacks NAT loopback. UPnP is off
by default. It maps only signaling TCP, never audio or WebRTC UDP, uses a short
renewable lease, and removes only the mapping created by this process. Failed
mapping keeps LAN hosting available. STUN providers are configurable; the
built-in server does not supply TURN.

The child is unpacked into a unique temporary directory only while hosting.
The private parent pipe supplies a transient owner bearer; the public host-login
endpoint rejects every caller, even localhost. One room is permitted and other
izci instances can join only as guests. Stop, switching to a client session,
reloading the playback window, or closing the player shuts down the child and
cleans up its files/mapping. A kill-on-close Windows job ties forced termination
to izci.exe; the short mapping lease covers an ungraceful exit. Owner credentials
and the native readiness snapshot are never persisted.

This target uses the existing File System Access pickers and **real Chromium
filesystem handles**, including writable handles used by the tools. Queue and
library records remain in their separate IndexedDB databases; remembered folder
handles remain in `izci-filesystem`. The stable `https://tauri.localhost` origin
and the app's persistent WebView2 profile preserve storage between launches.
This profile is separate from the installed/browser PWA. Native permission
handling allows file access selected by the user; remote navigation and frames
are blocked. Launch folder scans retain their existing permission checks.

The main window has a custom titlebar sharing the existing application menus,
with centered branding/version and native minimize, maximize/restore, and close
controls. Drag empty titlebar space to move it; double-click to maximize/restore.
The titlebar's Mini player button uses the same action as the application menu.
Options and tool windows use the same custom window controls and draggable
chrome. Native surfaces stay hidden until their content has mounted and painted.
Options warms up after the main window opens and hides on close, preserving its
UI for immediate reuse. Tool windows still close normally to release their jobs
and audio resources. Installed fonts are enumerated through Windows DirectWrite;
the desktop font picker never requests Chromium Local Font Access permission.

Open the Mini player button or menu action to show a frameless native window and
hide the main window. Drag it by the track text or empty space. Always-on-top,
restore, and close controls appear on hover or keyboard focus without reserving
a titlebar row. Native shadows are disabled to avoid Windows' nonclient border.
Its pin preference persists; its active state and playback snapshots do not.
Expanding it ends mini mode and restores the main window. Closing hides it to
the tray while keeping mini mode active; without a tray icon, it minimizes to
the taskbar instead. A single
tray click brings the mini player forward while in mini mode; a double-click
ends mini mode and opens the main window. Every main-window restoration closes
the mini player, so the two player surfaces cannot remain visible together.
The main window remains the sole playback
owner, including Multiplayer's effective state. All miniplayer actions go back
through its existing transport handlers. Chromium background timer throttling
is disabled for the native windows so minimized transport work can continue.

Native code lives in `src-tauri/`; native presentation and transport glue live
here. Vite resolves `$platform` to `src/platform/browser.ts` in PWA builds and
`src/desktop/platform.ts` only in desktop builds. `mini-player.html` and
`tray-menu.html` are inputs only for the desktop target. Desktop assets go to `dist-desktop/` and do not
generate/register a service worker. Existing Options/tool windows keep their
Chromium opener relationship through Tauri's new-window handler.

Native preferences live in a separate synchronized `izci.desktop-settings`
store, independent of per-track loadouts. Appearance's Show in dropdown offers
Taskbar only (the default), Tray only, and Both. Tray only hides the main window's
taskbar entry without hiding the window. Right-click opens the actual shared MenuSurface in a transparent,
frameless popup; transport uses the main runtime's effective playback commands.
Closing the main window still exits normally. Taskbar only removes the tray icon.
Owner close explicitly destroys the playback window and its hidden utilities,
then exits the native process. Window roles are recorded during navigation so
shutdown does not query disappearing WebView2 controllers. Hidden tray and
miniplayer controllers are created before the playback owner; enabling the tray
only changes the icon. This prevents Options warmup from reentering WebView2
controller creation. Single-instance restoration uses the same creation order.

File-type registration defaults on and adds per-user Open With / Default Apps
entries for the canonical internally supported extensions. Tracks can remove
the registrations or open Windows Default Apps to choose defaults. Registration
never writes UserChoice or takes another player's defaults. The portable exe's
current path is refreshed at launch; no installer or administrator rights are
required. `scripts/sync-desktop-formats.mjs` generates Rust's format map from
`src/lib/types.ts` during the desktop frontend build.

File icons are embedded in the EXE: every stream and AHX/HVL/MPTM/MOD/S3M/XM/IT/MO3
has an extension-labelled document, other modules share an underlined document,
and videos/images retain the application icon. `npm run desktop:icons` regenerates
the outlined SVGs and multi-resolution ICOs from `src-tauri/icons/file-types/`;
16/24/32 px use simplified artwork without labels. Desktop frontend builds run
this generator automatically. Existing defaults pointing to a shared stream or
module ProgID may need selecting izci again in Windows Default Apps to use a new
extension-specific registration. Registration never rewrites that user choice.

Single-instance activation delivers Explorer/command-line files to the playback
owner, honoring the existing associated-file add/replace preference. WebView2's
file-input bridge yields real disk-backed Chromium Files without copying media
bytes through IPC. Native path references persist in queue/library IndexedDB and
materialize on demand; directory handles and picker imports continue using real
File System Access handles. The browser build rejects native references.

## Invisible debugging

"Start headless tauri" is the project shorthand for:

```powershell
npm run desktop:headless -- start
npm run desktop:headless -- status
npm run desktop:headless -- eval --expression "({title: document.title, ready: document.readyState, headless: window.__izciHeadless})"
npm run desktop:headless -- probe --entry scripts/desktop/headless/artwork.ts
npm run desktop:headless -- stop
```

`start` mounts the packaged main app in a resident hidden, muted WebView2 window.
It copies `%LOCALAPPDATA%/app.izci.desktop/EBWebView` into a new
`.local/desktop-headless/sessions/` directory. The normal player, its executable,
and its profile remain untouched. Media files are still the real files referenced
by the copied handles/paths: probes should read them, not edit them. Saved autoplay
and Multiplayer restoration are disabled only in the copy; system media-key
integration, native registry/tray/focus operations, and popups are suppressed.
This harness tests the main runtime and its real native file/permission bridge;
it is not a test of native window presentation or multi-window shell behavior.

An unchanged build is reused, and `start` reuses an already-running session when
its source fingerprint is current. Source edits automatically replace the harness
with a fresh build/profile copy. Use `start --fresh` to take a new profile snapshot
even when the code is unchanged. Changes while
the snapshot is copied can make it inconsistent; copy/launch failures are reported
without closing the ordinary player. No dev server, browser debugging port, mouse,
or keyboard automation is involved.

`eval --script <file.js>` evaluates a script in the mounted app. Expressions may
return promises. `probe --entry <file.ts>` bundles a module exporting `run()` with
the desktop aliases, so it can exercise actual services/stores rather than rebuild
their logic. The checked-in artwork probe verifies extraction, image decoding,
album thumbnails, Details state, and independently checks missing covers. Probes
that return a `summary` print it concisely; their full results remain in the response file.
Bundled probes have their own module instances. Use `eval` and DOM events to
inspect/control the mounted app; do not import singleton playback owners into probes.
Results and native logs stay in the session directory; command responses include
their saved response path. Requests time out after 30 seconds (override with
`--timeout <seconds>`, up to 300), but the session
remains available and long probes can finish into that response file. Do not dump
signaling credentials, keys, tokens, SDP, or other secrets into diagnostic results.
Sessions use a local file inbox; `stop` exits only the harness and preserves its
profile/results for inspection. A failed or stale session is replaced on next start.

## Validation

```powershell
npm run build
npm run desktop:frontend
npm run desktop:verify
npm run check
npm run test -- src/desktop src/lib/stores/queue-materialization.test.ts src/lib/stores/queue-persistence.test.ts src/lib/services/filesystem-folders.test.ts src/lib/utils/files.test.ts
```

`desktop:verify` checks the actual output bundles and PWA precache for native
code/assets, and checks that the desktop build contains no service worker.
Native source formatting and the native origin test use `cargo fmt` and
`cargo test --release` from `src-tauri/` (add the relevant Windows target if needed).
Add `--features builtin-signaling` to test the embedded server's native lifecycle;
the default native tests and headless harness skip Go and the server source tree.
Frontend builds also skip Go protocol synchronization; use
`npm run multiplayer:protocol:sync` when preparing an independent server build.
`cargo run --example file_launch_smoke` from `src-tauri/` checks a Unicode path
and reads the selected disk-backed File through a hidden WebView2 window with a
disposable profile. It does not register file types or touch the player's data.
For restoration debugging, copy `%LOCALAPPDATA%/app.izci.desktop/EBWebView` into
a directory under the workspace's `.local/`, retaining the `EBWebView` folder.
Pass its parent directory to `cargo run --example profile_restoration_debug -- <copy>`
to inspect checkpoints, queue records, and real handle permissions. After
`npm run desktop:frontend`, `profile_playback_smoke` accepts the same argument
and verifies the packaged Howler backend resumes beyond the saved position.
Both require a workspace-local copy; the playback check disables native shell
side effects and keeps its window hidden. The copied checkpoint advances during playback.
`cargo run --example shell_smoke` checks repeated opener-linked Options creation
on cold and cached loads, hidden warmup and native presentation, then tray
enable/disable through WebView2 IPC. It closes the owner using the titlebar's native API, with hidden Options and
mini-player windows present. Add `-- --workbench` to check Troubadour's independent
lifetime. This harness uses an isolated app identifier and does not run playback
or change file-type registrations.

Manual acceptance: import a file and a managed folder, restart and play restored
items, then test stream/module/Hively/video playback while minimized and control
it from the miniplayer. Check writable handles with a tool export, tray menu
actions, and file activation through Explorer. This MVP does not add
notifications or installers.
