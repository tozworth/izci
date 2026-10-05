<table>
<tr>
<td><img height="75" src="https://raw.githubusercontent.com/dunsparce9/izci/refs/heads/main/docs/screenshots/carousel1.png" /></td>
<td><img height="75" src="https://raw.githubusercontent.com/dunsparce9/izci/refs/heads/main/docs/screenshots/carousel2.png" /></td>
<td><img height="75" src="https://raw.githubusercontent.com/dunsparce9/izci/refs/heads/main/docs/screenshots/carousel3.png" /></td>
<td><img height="75" src="https://raw.githubusercontent.com/dunsparce9/izci/refs/heads/main/docs/screenshots/carousel4.png" /></td>
</tr>
</table>

## <img height="30" src="https://raw.githubusercontent.com/dunsparce9/izci/refs/heads/main/public/icons/izci-icon.svg"> izci

A local music player [PWA](https://en.wikipedia.org/wiki/Progressive_web_app). It plays regular audio files and tracker modules. Compact interface, low CPU usage, several UI modes to adapt to any window size, and a lot of oddly specific settings (logarithmic volume slider anyone?)

izci is mostly a personal hobby project. It has already reached "daily driver" status, but is still missing many, many features that will be added once I realize they're missing.

<img height="100" alt="image" src="https://raw.githubusercontent.com/dunsparce9/izci/refs/heads/main/docs/screenshots/small1.png" />


## Features

- Plays common audio formats (`mp3`, `wav`, `flac`, `ogg`, `opus`) and tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3` and more via included libopenmpt WASM; `ahx` and `hvl` via the included HivelyTracker replayer)
- Persistent, auto-updating library with playcounts and favorites
- OS-level file associations
- Reads embedded metadata, artwork, time-synced lyrics, ReplayGain for audio tracks; plus instrument names and patterns for modules
- Dockable Queue, Library, Track Details, Lyrics, and Patterns views
  - Includes big moody blurry "Now Playing" mode (Apple Music theater mode larp)
- Optional Web Audio effects rack with presets and import/export
  - EQ, stereo width, crystalizer, loudness processing, dynamic auto-amp, and convolution reverb
- Works offline after installation and does not require a backend (fully static)

> [!WARNING]
> izci attempts to use every obscure Project Fugu-adjacent feature/API it can get its hands on. It's essentially a PWA stress test.
> 
> Since there are 50 quadrillion web browsers, some may not support all the features that izci was designed around: the File System Access API, Web Audio API, Launch Handler API and Launch Queue API (for file associations), plus UI/UX niceties such as Window Controls Overlay API(custom titlebar), Document Picture-in-Picture API (mini mode), Media Session API, and Local Font Access API.
>
> * Chrome, Chromium (stock, Ungoogled, Thorium, Helium...) and Edge work perfectly
>   * After install, press the top-right <img width="25" alt="Hide title bar chevron in Chromium" src="https://github.com/user-attachments/assets/a9415e43-29a9-43e5-9cb1-e949e3ae3928"/> chevron to enable the custom titlebar
> * Firefox works with caveats:
>   * Firefox web apps / "taskbar apps" are [Windows only](https://support.mozilla.org/en-US/kb/web-apps-firefox-windows); izci will run as a tab on other platforms
>   * Window borders will be thick, as Firefox lacks WCO even if izci is "installed"
> * Safari explodes.

## Install

Go to [izci.ağla.net](https://izci.ağla.net) and hit the "Install app" button in the address bar, *or* use izci's own "Install" entry under File. Both trigger the same PWA install prompt on Chromium browsers.

<img width="268" height="219" alt="'Install izci...' highlighted in izci's top-bar 'File' menu" src="https://github.com/user-attachments/assets/4c960cae-bc82-49a5-b681-a78db9d2d838" />


## Build / develop

```sh
npm install
npm run dev
```

Vite will print the local address, which you can then open in "any browser" (see the warning above).
> [!TIP]
> ```sh
> npm run check   # Svelte and TypeScript checks
> npm test        # unit tests
> npm run build   # production PWA build
> npm run preview # serve the production build locally
> ```
> The production build is written to `dist/`.
>
> Locally running izci instances will automatically pick up the updated service worker (and refresh the shell) after an `npm run build && npm run preview`. You can also force an update (Help > Force update).

HTML entry pages live in `pages/`; Vite serves and emits them at their existing root URLs (such as `/options.html`). Application code remains in `src/` and static assets in `public/`.

Multiplayer uses a self-hosted izci-server for signaling. Official builds have no server configured; hosts configure their server under Hosting and guests join with an izci-server invitation. Firebase Hosting serves the PWA; Firebase Auth and Realtime Database signaling are retired.

### Windows executable

`npm run desktop:build` builds a single `.local/desktop/izci.exe` with all frontend assets and playback runtimes embedded. It needs Windows and an installed WebView2 Runtime; no application DLLs or adjacent asset files are required. Building requires the Rust MSVC toolchain and Microsoft C++ Build Tools.

Release builds optimize native code for size, omit unused Tauri commands, Brotli-compress embedded assets, and pack the executable with [UPX](https://upx.github.io/) using LZMA. The pinned, checksum-verified UPX build tool downloads on the first build and is cached under `.local/desktop-toolchain/` for subsequent offline builds. It is not needed to run izci. Packing adds a small decompression step at launch. `npm run desktop:build -- --no-compress` produces an unpacked executable for diagnostics. Rust panics abort the release process rather than unwinding.

The build checks for external DLL imports before packing and checks the packed executable's integrity. If the current executable is running, the new build is saved to `.local/desktop-next/izci.exe`.

Desktop and PWA media playback use disk-backed file URLs without copying entire streams or videos into memory. Metadata, embedded FLAC/Opus artwork, and Vorbis lyrics use bounded file-range reads; artwork pictures are limited to 16 MiB and lyrics comments to 1 MiB. Android alone retains small-file snapshots for faster provider reads, with metadata snapshots bounded to 16 MiB per file and 32 MiB across active jobs. Hidden desktop utility WebViews stop rendering and request WebView2's lower memory target, then restore normal rendering when opened. Hardware acceleration remains enabled, and the playback owner's WebView stays active.

## Built with

[Svelte](https://svelte.dev/), [Vite](https://vite.dev/), [Howler.js](https://howlerjs.com/) (standard audio formats), [libopenmpt](https://lib.openmpt.org/) (tracker modules through izci’s WASM controller and worklet), and the [HivelyTracker](https://github.com/pete-gordon/hivelytracker) replayer (`ahx` and `hvl`).

## License

izci's original code, documentation, and assets are licensed under the MIT License.
Bundled third-party components remain under their respective licenses, including MIT-licensed Howler.js, Svelte, and Workbox; BSD-3-Clause-licensed libopenmpt and the HivelyTracker replayer; and Apache-2.0-licensed Material Symbols.

See [LICENSE.md](LICENSE.md) for the full license and third-party notices.

## Name

“İzci” means “tracker”/“scout” in Turkish.

The intentionally lowercase spelling keeps the package and file names uneventful, as the 'İ' [breaks things](https://stackoverflow.com/questions/796986/what-is-the-turkey-test).
