<img src="https://raw.githubusercontent.com/dunsparce9/izci/refs/heads/main/public/icons/izci-icon.svg" width="100" alt="izci logo">

## izci

A local music player PWA. It plays regular audio files and tracker modules from the same library.

## What it does

- Plays streamed audio (`mp3`, `wav`, `flac`, `ogg`, and `opus`) alongside tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3`, and other formats supported by the bundled OpenMPT build)
- Imports individual files or folders through Chromium's File System Access APIs, with familiar fallbacks where those APIs are unavailable
- Keeps separate playlist and library collections, stored locally in IndexedDB
- Reads embedded metadata, artwork, lyrics, ReplayGain data, and tracker details where the format allows it
- Provides dockable Playlist, Library, Track Details, and Lyrics views, plus a focused Now Playing layout
- Includes artwork and spectrum visualizer backdrops, synced lyrics, media-key support, and desktop-oriented window controls
- Offers an optional Web Audio effects rack with EQ, stereo width, crystalizer, loudness processing, and convolution reverb
- **Works offline after PWA installation and does not require a backend**

Streamed formats use Howler.js in HTML5 audio mode, tracker modules use Chiptune3 and Web Audio.

## What to know

izci targets desktop Chromium-adjacent browsers and installed PWA use. Since there are 50 quadrillion Chromium browsers, some of them may or may not support all relevant PWA features (File System Access API, Window Controls Overlay, Web Audio API) that make izci actually usable.

Edge and Helium work fine.

The project is currently pre-alpha and mainly used for personal testing. Features move around, saved state may be reset between versions, and there is no migration promise yet.

## Run / install

Go to [izci.ağla.net](https://izci.ağla.net) and hit the "Install app" icon on the address bar.

If your browser hates IDNs, use [izci-pwa.web.app](https://izci-pwa.web.app) Firebase Hosting URL.

## Build

You will need a recent Node.js release and npm.

```sh
npm install
npm run dev
```

Vite will print the local address. Open it in Chrome-or-what-have-you.

```sh
npm run check   # Svelte and TypeScript checks
npm test        # unit tests
npm run build   # production PWA build
npm run preview # serve the production build locally
```

The production build is written to `dist/`.

## Built with

[Svelte](https://svelte.dev/), [Vite](https://vite.dev/), [Howler.js](https://howlerjs.com/), [Chiptune3](https://github.com/DrSnuggles/chiptune), and the browser's Web Audio, File System Access, Media Session, and PWA APIs.

## Name

“İzci” means “tracker”/“scout” in Turkish. The ASCII spelling keeps the package and file names uneventful.
