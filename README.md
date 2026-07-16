<img height="75" src="https://github.com/user-attachments/assets/c325330f-c719-4ca2-b1a2-0c6ad2017597" />
<img height="75" src="https://github.com/user-attachments/assets/ea4b796b-483e-4866-9a20-cb997531d359" />
<img height="75" src="https://github.com/user-attachments/assets/931b5af4-643e-4024-8d17-926c3c7f84f8" />
<img height="75" src="https://github.com/user-attachments/assets/ab124936-b1e6-4a0f-b66d-eaea9c87ddca" />

## <img height="30" src="https://raw.githubusercontent.com/dunsparce9/izci/refs/heads/main/public/icons/izci-icon.svg"> izci

A local music player [PWA](https://en.wikipedia.org/wiki/Progressive_web_app). It plays regular audio files and tracker modules. Compact interface, low CPU usage, several UI modes to adapt to any window size, and an unreasonable number of oddly specific settings (logarithmic volume slider anyone?)

izci is mostly a personal hobby project. It has already reached "daily driver" status, but is still missing many, many features that will be added once I realize they're missing.

## Features

- Plays most audio files (`mp3`, `wav`, `flac`, `ogg`, and `opus`) and tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3` and more)
- Imports files/folders through the File System Access API
- OS-level file associations via the Launch Queue API
- Reads embedded metadata, artwork, time-synced lyrics, ReplayGain, module instrument names
- Dockable Playlist, Library, Track Details, and Lyrics views
  - Includes big moody blurry "Now Playing" mode (Apple Music theater mode larp)
- Optional Web Audio effects rack with presets and import/export
  - EQ, stereo width, crystalizer, loudness processing, and convolution reverb
- Works offline after installation and does not require a backend
  - PWAs are wonderful aren't they

> [!WARNING]
> izci attempts to use every obscure Project Fugu-adjacent feature/API it can get its hands on. It's essentially a PWA stress test.
> 
> Since there are 50 quadrillion web browsers, some may not support all the features that izci was designed around: the File System Access API, Web Audio API, Launch Handler API and Launch Queue API (for file associations), plus UI/UX niceties such as Window Controls Overlay (custom titlebar), Media Session API and Local Font Access API.
>
> * Chrome, Chromium (stock, Ungoogled, Thorium/Helium...) and Edge work perfectly
>   * After install, press the top-right <img width="25" alt="Hide title bar chevron in Chromium" src="https://github.com/user-attachments/assets/a9415e43-29a9-43e5-9cb1-e949e3ae3928"/> chevron to enable the custom titlebar
> * Firefox works with caveats:
>   * Firefox web apps / "taskbar apps" are [Windows only](https://support.mozilla.org/en-US/kb/web-apps-firefox-windows); izci will run as a tab on other platforms
>   * Window borders will be thick, as Firefox lacks WCO even if izci is "installed"
> * Safari explodes.

## Run / install

Go to [izci.ağla.net](https://izci.ağla.net) and hit the "Install app" button in the address bar, *or* use izci's own "Install" entry under File. Both trigger the same Chromium PWA install prompt.

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
> Running izci instances will automatically pick up the updated service worker (and refresh the shell) after an `npm run build`. You can also force an update (Help > Force update).

## Built with

[Svelte](https://svelte.dev/), [Vite](https://vite.dev/), [Howler.js](https://howlerjs.com/) (standard audio formats), [Chiptune3](https://github.com/DrSnuggles/chiptune) (tracker modules; based on libopenmpt WASM).

## License

izci's original code, documentation, and assets are licensed under the MIT License.
Bundled third-party components remain under their respective licenses,
including MIT-licensed Chiptune3, Howler.js, Svelte, and Workbox;
BSD-3-Clause-licensed libopenmpt; and Apache-2.0-licensed Material Symbols.
See [LICENSE.md](LICENSE.md) for the full license and third-party notices.

## Name

“İzci” means “tracker”/“scout” in Turkish. The intentionally lowercase ASCII spelling keeps the package and file names uneventful.
