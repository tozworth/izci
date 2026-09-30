# Windows desktop MVP

Build with `npm run desktop:build`. The runnable output is
`.local/desktop/izci.exe`; keep any DLLs in that directory alongside the executable.
If the current executable is locked by a running player, the new build is saved
to `.local/desktop-next/izci.exe` instead, leaving the playback session intact.
The current GNU build includes Microsoft's `WebView2Loader.dll`. An installed
Evergreen WebView2 runtime is required. Rust and a Windows C/C++ toolchain are
build dependencies only. The build script also recognizes the workspace-local
Rust installation under `.local/desktop-toolchain/`.

This target uses the existing File System Access pickers and **real Chromium
filesystem handles**, including writable handles used by the tools. Queue and
library records remain in their separate IndexedDB databases; remembered folder
handles remain in `izci-filesystem`. The stable `https://tauri.localhost` origin
and the app's persistent WebView2 profile preserve storage between launches.
This profile is separate from the installed/browser PWA. Native permission
handling allows file access selected by the user; remote navigation and frames
are blocked. Launch folder scans retain their existing permission checks.

Open the existing Mini player menu action to show a frameless native window and
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
`src/desktop/platform.ts` only in desktop builds. `mini-player.html` is an input
only for the desktop target. Desktop assets go to `dist-desktop/` and do not
generate/register a service worker. Existing Options/tool windows keep their
Chromium opener relationship through Tauri's new-window handler.

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

Manual acceptance: import a file and a managed folder, restart and play restored
items, then test stream/module/Hively/video playback while minimized and control
it from the miniplayer. Check writable handles with a tool export. This MVP
does not add tray integration, server packaging, notifications, or installers.
