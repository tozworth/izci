# Windows desktop MVP

Build with `npm run desktop:build`. The runnable output is
`.local/desktop/izci.exe`; this is the only app file needed for distribution.
If the current executable is locked by a running player, the new build is saved
to `.local/desktop-next/izci.exe` instead, leaving the playback session intact.
The MSVC build statically links the WebView2 loader and Visual C++ runtime, so
there is no `WebView2Loader.dll` sidecar. An installed Evergreen WebView2 runtime
is still required. Build dependencies are the Rust MSVC toolchain
(`rustup toolchain install stable-x86_64-pc-windows-msvc`) and Microsoft C++ Build
Tools with the Desktop development with C++ workload. The build script defaults
to `stable-x86_64-pc-windows-msvc`, honors an MSVC `RUSTUP_TOOLCHAIN` override,
and recognizes workspace-local Rust under `.local/desktop-toolchain/`.

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
minimize the main window. Drag it by the track text or empty space. Always-on-top,
restore, and close controls appear on hover or keyboard focus without reserving
a titlebar row. Native shadows are disabled to avoid Windows' nonclient border.
Its pin preference persists; its active state and playback snapshots do not.
Closing it restores the main window. The main window remains the sole playback
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
store, independent of per-track loadouts. Appearance includes the tray icon, which
defaults off. Right-click opens the actual shared MenuSurface in a transparent,
frameless popup; transport uses the main runtime's effective playback commands.
Closing the main window still exits normally. Disabling the icon removes it.
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

Single-instance activation delivers Explorer/command-line files to the playback
owner, honoring the existing associated-file add/replace preference. WebView2's
file-input bridge yields real disk-backed Chromium Files without copying media
bytes through IPC. Native path references persist in queue/library IndexedDB and
materialize on demand; directory handles and picker imports continue using real
File System Access handles. The browser build rejects native references.

Validation:

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
actions, and file activation through Explorer. This MVP does not add server
packaging, notifications, or installers.
