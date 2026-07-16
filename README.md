<img src="https://raw.githubusercontent.com/dunsparce9/izci/refs/heads/main/public/icons/izci-icon.svg" width="100" alt="izci logo">

## izci

A local music player PWA.

It plays regular audio files and tracker modules, with a compact interface, low CPU usage, and many interface modes with goldilocks-tier knobs/switches. It has already reached "daily driver" state, however is still missing many, many features that will be added once I realize they're missing.

## What it does

- Plays music.
  - Streamed audio (`mp3`, `wav`, `flac`, `ogg`, and `opus`) alongside tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3` and more)
- Imports files/folders through File System Access API
- **OS-level file associations** and launch handling via launchQueue
- Reads embedded metadata, artwork, timesynced lyrics, ReplayGain, module instrument names / notes
- Dockable Playlist, Library, Track Details, and Lyrics views
  - Includes big moody blurry "Now Playing" mode (Apple Music theater mode larp)
- Optional Web Audio effects rack with presets and import/export
  - EQ, stereo width, crystalizer, loudness processing, and convolution reverb
- **Works offline after PWA installation and does not require a backend**
  - PWAs are wonderful aren't they

Streamed formats use Howler.js, tracker modules use Chiptune3 (which in turn uses libopenmpt WASM).

> [!WARNING]
> izci attempts to use every obscure Project Fugu-adjacent feature/API it can get its hands on. It's essentially a PWA stress test.
> 
> Since there are 50 quadrillion web browsers, some may not support all the features that make izci actually usable: the File System Access API, Web Audio API, Launch Handler API and Launch Queue API (for file associations), plus UI/UX niceties such as Window Controls Overlay (custom chrome), Media Session API and Local Font Access API.
>
> * Edge and Helium work perfectly.
> * Firefox works with caveats:
>   * Firefox web apps / "taskbar apps" are [Windows only](https://support.mozilla.org/en-US/kb/web-apps-firefox-windows); izci will run as a tab on other platforms.
>   * Window borders will be thick, as Firefox lacks WCO even if izci is "installed".
> * Safari explodes.

## Run / install

Go to [izci.ağla.net](https://izci.ağla.net) and hit the "Install app" icon on the address bar.

If your browser hates IDNs, use [izci-pwa.web.app](https://izci-pwa.web.app) Firebase Hosting URL.

## Build

You will need a recent Node.js release and npm.

```sh
npm install
npm run dev
```

Vite will print the local address, which you can then open in ~~Helium~~ "any browser".
> [!TIP]
> Useful commands:
> ```sh
> npm run check   # Svelte and TypeScript checks
> npm test        # unit tests
> npm run build   # production PWA build
> npm run preview # serve the production build locally
> ```

The production build is written to `dist/`.

## Built with

[Svelte](https://svelte.dev/), [Vite](https://vite.dev/), [Howler.js](https://howlerjs.com/), [Chiptune3](https://github.com/DrSnuggles/chiptune), and the browser's Web Audio, File System Access, Media Session, and PWA APIs.

## Name

“İzci” means “tracker”/“scout” in Turkish. The ASCII spelling keeps the package and file names uneventful.
