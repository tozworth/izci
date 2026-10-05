# libopenmpt runtime artifact

`libopenmpt.wasm` is libopenmpt **0.8.4**, extracted byte-for-byte from the
previously bundled Emscripten single-file artifact. `runtime.js` is its matching
generated Emscripten loader, with the inline base64 payload replaced by required
`wasmBinary` input and Node loading disabled for browser/worklet use. No
Chiptune player or worklet code is used. The artifact originated in the
chiptune3 0.8.4 distribution; retained loader support keeps its MIT attribution.

Upstream source: https://github.com/OpenMPT/openmpt/tree/libopenmpt-0.8.4

The binary reports MINIZ, MINIMP3, STBVORBIS and PLUGINS. Retained licenses and
notices are in the repository's `LICENSE.md` and `docs/THIRD-PARTY-NOTICES.md`.
The loader's `getWasmTableEntry` export exposes libopenmpt's documented
`interactive` C interface for channel mute controls; wasm32 ABI details live
only in `services/openmpt/module.ts`.

Vite emits WASM as a hashed asset and statically bundles the loader into workers
and the worklet (dynamic import is prohibited in worklets). Workers reuse one
WASM heap per realm. AudioWorklets receive the binary through
`processorOptions`, so initialization needs no network or DOM APIs on the audio
thread. The generated loader supplies clock/random fallbacks for AudioWorklet
realms. The PWA precaches WASM, the decoder worker and playback worklet including
their bundled loaders.

To replace the artifact, use a matching Emscripten ES-module build of the pinned
libopenmpt source, with memory growth, synchronous WASM instantiation, stack
helpers, UTF8ToString, the public C API and `getWasmTableEntry` exported. Keep the
loader and binary together and run the real-WASM tests in `services/openmpt/`.

The app integration lives in `services/openmpt/`: module ownership and string
allocation, typed worklet protocol, audio controller, background inspection,
and shared playback/offline render bindings. Background metadata requests read
counts and text only; pattern grids are expanded separately for active tracks
and never persisted. Verification creates and destroys a decoder handle without
creating an AudioContext, starting playback, or formatting patterns.
