## <img height="30" src="https://raw.githubusercontent.com/tozworth/izci/refs/heads/main/public/icons/izci-icon.svg"> izci

A local music player [PWA](https://en.wikipedia.org/wiki/Progressive_web_app). It plays regular audio files and tracker modules. Compact interface, low CPU usage, several UI modes to adapt to any window size, and a lot of oddly specific settings (logarithmic volume slider anyone?)

izci is mostly a personal hobby project. It has already reached "daily driver" status, but is still missing many, many features that will be added once I realize they're missing.

## Features

- Plays common audio formats (`mp3`, `wav`, `flac`, `ogg`, `opus`) and tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3` and more via libopenmpt; `ahx` and `hvl` via HivelyTracker)
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

Go to [izci.ağla.net](https://izci.ağla.net) and hit the "Install app" button in the browser's address bar, *or* use izci's own "Install" entry under the "glyph menu". Both trigger the same PWA install prompt on Chromium browsers.

<img width="347" height="367" alt="'Install izci...' highlighted in izci's top-bar 'glyph menu'" src="https://github.com/user-attachments/assets/68bc0c0f-f051-4b3d-a7a2-3bdb60e92797" />

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

The optional "Multiplayer" mode uses a self-hosted server for signaling. Configure your server under Hosting and guests can join with an izci-server invitation.

### Tauri build

While izci remains a PWA (and most dev work is focused on not breaking the PWA), there's an optional Windows-only Tauri build that adds small niceties such as a better miniplayer, system tray icons/bubbles and custom icons for file associations. Build with `npm run desktop:build`.

## Built with

[Svelte](https://svelte.dev/), [Vite](https://vite.dev/), [Howler.js](https://howlerjs.com/) (standard audio formats), [libopenmpt](https://lib.openmpt.org/) (tracker modules through izci’s WASM controller and worklet), and the [HivelyTracker](https://github.com/pete-gordon/hivelytracker) replayer (`ahx` and `hvl`).

## License

izci's original code, documentation, and assets are licensed under the MIT License.
Bundled third-party components remain under their respective licenses, including MIT-licensed Howler.js, Svelte, and Workbox; BSD-3-Clause-licensed libopenmpt and the HivelyTracker replayer; and Apache-2.0-licensed Material Symbols.

See [LICENSE.md](LICENSE.md) and [third-party notices](docs/THIRD-PARTY-NOTICES.md) for the full license texts.

## Name

“İzci” means “tracker”/“scout” in Turkish.

The intentionally lowercase spelling keeps the package and file names uneventful, as the 'İ' [breaks things](https://stackoverflow.com/questions/796986/what-is-the-turkey-test).
