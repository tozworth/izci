# izci.apk MVP

Platform: a small Kotlin Activity hosting Android System WebView, with AndroidX WebKit's origin-scoped message bridge and `WebViewAssetLoader`. The APK packages izci's existing mobile UI and playback/DSP services. Capacitor would still need this custom SAF integration; Tauri would add a Rust/mobile pipeline without removing it. This shell keeps the file-access implementation directly on Android's APIs.

Requires Android 8 (API 26) or newer and an up-to-date Android System WebView.

## File access

- **Add files** opens `ACTION_OPEN_DOCUMENT` with multiple selection. The unrestricted MIME filter includes tracker formats Android does not recognize. izci's existing extension inference and unknown-module verification apply afterward.
- **Add folder** and **Options > Folders > Add folder** open `ACTION_OPEN_DOCUMENT_TREE`. Android's `takePersistableUriPermission` keeps read access across process death and reboot. Providers must support persistent grants; unsupported selections fail instead of silently retaining only temporary access.
- Existing manual scans, scan on launch, scan-depth tweaks, Check access, and Forget controls remain available. Launch scans never open a picker. Check access opens one only when access needs restoration, and requires the same root to avoid redirecting an existing library to another folder.
- Queue/library/favorites IndexedDB stores retain content-URI references and ordinary track metadata. Managed-folder references remain in the separate `izci-filesystem` IndexedDB. Lightweight settings remain in localStorage and retain same-origin synchronization.
- SAF enumeration queries names/sizes/timestamps, not media bytes. Media elements use local HTTPS URLs backed by ContentResolver streams with byte ranges, so large videos are not copied into memory or app storage. Transient File/Blob views supply bounded reads to metadata readers and complete reads to tracker/Hively decoders. These views must not be serialized, passed to FileReader, wrapped in another Blob, or used with `URL.createObjectURL`; use `createMediaFileUrl` for media sources.
- WebView applies the requested range by skipping within the returned document stream, including for a 206 response. Keep that stream at document byte zero, report the complete document size, and bound reads at the validated range end; pre-seeking applies the start offset twice and breaks decoding.
- Android grants are read-only. Forget removes a managed root from izci, while retaining its OS grant because queue/library references may still use it. Revoking access through Android, moving/deleting documents, removing storage, or uninstalling/clearing app data can require selecting files/folders again. Provider files without a usable size cannot currently be imported.
- This APK has a separate origin/profile from the Chrome PWA and does not automatically import that PWA's library or permissions. Select the folders once in the APK. Portable backup root relinking through SAF is outside this MVP.

The package serves assets and documents from `https://appassets.androidplatform.net`; it does not start a network server or register a service worker. The bridge is main-frame-only and restricted to that origin. External page navigation leaves the WebView, and content URIs must be covered by persisted grants. No all-files/storage permission is requested.

## Build

Install JDK 17 and the Android SDK command-line tools, then install `platforms;android-36` and `build-tools;35.0.0`. Set `JAVA_HOME` and `ANDROID_HOME`. Gradle 8.13 is downloaded by the checked-in wrapper and pinned by checksum. The initial setup on this Windows machine lives under `%LOCALAPPDATA%\izci-android-tools`; the build script detects that installation.

```powershell
npm run android:build
```

This builds the Android frontend with `NODE_ENV=development` (including Svelte runtime checks), unminified JS/CSS, and source maps containing original TS/Svelte sources for app and worker bundles. It runs native unit tests, assembles a debuggable APK without R8 minification, and copies it to `artifacts/android/izci.apk`. The debug key is Android's normal local debug key; keeping it permits installing later MVP builds over this one without clearing the app's grants/profile. This is currently a development target; a release packaging flow is not provided.

```powershell
adb install -r artifacts/android/izci.apk
```

After only Kotlin changes, use `npm run android:build -- --skip-web`. It requires previously built development web assets; an old optimized build fails with a rebuild instruction. `npm run android:frontend` prepares those assets without assembling the APK. `npm run android:test` runs the native unit tests against already-built web assets. Frontend tests live in `src/android/` and the existing import/materialization/persistence/folder tests. Debugging transport tests use `node --test scripts/android/debugging.node-test.mjs`. The APK build is independent of Rust, Go and the Windows desktop build.

## Emulator debugging without Android Studio

Use Node 22 or newer, JDK 17 (`JAVA_HOME`), and the standalone Android SDK. On this Windows
machine the commands automatically find the existing SDK/JDK under
`%LOCALAPPDATA%/izci-android-tools`; elsewhere `ANDROID_HOME` (or `ANDROID_SDK_ROOT`)
selects the SDK. The setup command can download the Windows command-line tools with
a pinned SHA-256 checksum, then install the emulator, platform-tools (ADB), and the
Android 16/API 36 Google APIs x86_64 image. SDK package revisions follow Google's
stable repository; the API, image flavor, architecture, and Pixel 7 device definition
are fixed. JDK installation is a prerequisite, not part of this bootstrap.

```powershell
npm run android:emulator -- setup
npm run android:emulator -- start
npm run android:emulator -- status
npm run android:emulator -- eval --expression "({title: document.title, ready: document.readyState})"
npm run android:emulator -- eval --script .local/android-probe.js
npm run android:emulator -- reload
npm run android:emulator -- debug --script .local/android-debug.mjs
npm run android:emulator -- logs --dump
npm run android:emulator -- screenshot
npm run android:emulator -- stop
```

Setup may ask you to accept SDK licenses; it does not silently accept them. Enable
Windows Hypervisor Platform and BIOS virtualization if the acceleration check fails;
Windows feature changes can require a reboot. Android Studio and a dev server are
unnecessary. On other operating systems, provision the equivalent SDK packages and
AVD manually; automated bootstrap currently targets Windows.

`start` runs a resident emulator with no window or host audio. `start --window` opens
the emulator for touch, file-picker, keyboard, and visual debugging. A running instance
is reused; stop it first to change between visible and headless modes. The dedicated
AVD is `izci_android16` at `emulator-5554`. Commands verify its name before operating
on it, and reject a different emulator occupying that port. Physical phones and the
Windows desktop player's profile are not used. Emulator output and the last installed
APK fingerprint live in ignored `.local/android-emulator/`; the AVD data itself lives
in the Android SDK's normal user AVD directory. Closing/stopping it keeps its izci
settings, IndexedDB library, and SAF grants for the next session.

`start` installs `artifacts/android/izci.apk` when its hash changes or the app is missing,
using `adb install -r` to keep data, then launches izci if it is stopped. `install` forces
reinstallation and launch. Neither command builds or watches source files. After source
edits, build the APK using the build command above, then run `start` or
`install`. Keep the debug signing key for updates; a signature mismatch fails instead
of uninstalling the app and deleting its data. Use Android's Settings UI or an explicit
ADB command if you deliberately want to clear the test profile.
`start` and `install` verify the development-build marker inside the APK so a stale
optimized frontend cannot silently enter the debugging session. During user-requested
debugging sessions, relevant rebuilds, reinstalls, reloads, and restarts are authorized
by the project guide; outside those sessions, builds require an explicit request.

The debug APK enables WebView debugging. `eval` finds izci's WebView socket, creates a
temporary ADB forward, evaluates JavaScript through CDP (including promises), and
removes the forward afterward. Errors cause a nonzero exit; requests time out after
30 seconds without stopping the emulator. A script's final expression is its result.
This operates on the installed bundled app, so rebuilding is required for source
changes. For interactive DevTools, open `chrome://inspect/#devices` in desktop Chrome
and inspect izci; no browser is opened by these commands. Enable JavaScript source maps
in DevTools settings to inspect original TS/Svelte files and set source breakpoints.
App and worker maps are packaged and served locally; no dev server is needed. Third-party
precompiled JavaScript/WASM can still require upstream debug symbols for original-source
inspection. `reload` reloads the installed web assets without rebuilding or clearing data.

`debug --script` runs a local Node ES module exporting a default async function with
`{ cdp, target }`. Unlike `eval`, it keeps one CDP connection alive while your script
waits for a reproduction, handles pause events, inspects scopes, or steps through code.
Use `cdp.send(method, params, { timeoutMs })`, `cdp.on(event, listener)` (returns an
unsubscribe function), and `cdp.waitFor(event, { predicate, timeoutMs })`. Register an
event wait before triggering its action. CDP location lines/columns are zero-based;
DevTools maps source breakpoints automatically, while direct CDP scripts must map
original locations to generated bundle positions using the emitted source maps.

For example, save this as `.local/android-debug.mjs`, run the command above, then
reproduce an uncaught JavaScript exception in the emulator:

```javascript
export default async function ({ cdp }) {
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
  await cdp.send('Debugger.setPauseOnExceptions', { state: 'uncaught' });
  const paused = await cdp.waitFor('Debugger.paused', { timeoutMs: 120_000 });
  // Inspect while paused before returning:
  // await cdp.send('Debugger.evaluateOnCallFrame', {
  //   callFrameId: paused.callFrames[0].callFrameId,
  //   expression: 'yourLocalVariable', returnByValue: true
  // });
  return {
    reason: paused.reason,
    frames: paused.callFrames.map(({ functionName, url, location }) => ({ functionName, url, location }))
  };
}
```

The wrapper resumes execution and closes the CDP connection/temporary ADB forward
when the script finishes or throws. Avoid dumping scope objects wholesale: they can
contain credentials or media paths. Chrome DevTools provides the interactive UI for
breakpoints, stepping, async stacks, network traces, and profiles. Kotlin/native
breakpoints use a separate Java debugger attached via ADB/JDWP (`adb jdwp` lists
debuggable process IDs); Chrome's JavaScript debugger does not step into Kotlin.

Native debugging uses the same SDK's ADB with the izci emulator explicitly selected:

```powershell
npm run android:emulator -- adb shell dumpsys package app.izci.android
npm run android:emulator -- adb shell dumpsys webviewupdate
npm run android:emulator -- adb shell am force-stop app.izci.android
npm run android:emulator -- start
npm run android:emulator -- adb push fixtures /sdcard/Download/izci-fixtures
npm run android:emulator -- adb logcat -d -t 200 AndroidRuntime:E "*:S"
npm run android:emulator -- logs
```

`logs` follows logcat for the current izci PID (Ctrl+C stops only the log follower);
rerun it after the app process restarts. `logs --dump` returns up to 500 recent entries.
Use raw `adb logcat` through the wrapper for system/provider issues, and `adb shell`,
`push`, `pull`, `exec-out`, or `jdwp` for native investigations. Do not include device
selection flags: the wrapper already selects the dedicated emulator. Fixture files
still need importing through izci's SAF picker. A headless run does not validate touch
presentation, real-device audio/background behavior, or OEM document providers.
Keep diagnostic expressions and shared log excerpts free of signaling credentials,
tokens, SDP, and other secrets.

Reference: [standalone SDK tools](https://developer.android.com/studio#command-tools),
[emulator acceleration](https://developer.android.com/studio/run/emulator-acceleration),
and [WebView DevTools](https://developer.chrome.com/docs/devtools/remote-debugging/webviews).

## Device acceptance check

1. Install and launch the APK, select individual audio files and a folder, then play stream, tracker, Hively and video fixtures and seek in the media-element formats.
2. In Options > Folders add that root to the library and enable scan on launch. Confirm scans honor the nesting limit.
3. Force-stop the app, reopen it, then reboot the phone and reopen it. Confirm restored queue/library playback and launch scans need no Allow dialogs.
4. Add/remove a file under the root and rescan. Confirm only that root is reconciled and existing IDs/play counts/ratings survive.
5. Revoke access or remove the storage, then launch again. Confirm the library is retained and no picker opens automatically. Restore access with Check access and reselect the same folder.
6. Cancel each picker and attempt to select a different root during recovery. Confirm existing folder/library records remain intact.

Notifications, foreground/background playback services, screen-off behavior/validation, file associations, native TCP Multiplayer and store publication/signing are deferred. Current verification covers compilation, frontend persistence/materialization/byte-reader tests, native range-parser/document-stream tests, and emulator FLAC playback/seeking with byte-for-byte range checks; real-device SAF persistence/playback acceptance remains required.
