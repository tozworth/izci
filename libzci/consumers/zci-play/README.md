# zci-play

Native file player and streaming PCM renderer over libzci: WAV, MP3, FLAC,
Vorbis, reference Opus, OpenMPT modules (MOD/XM/S3M/IT/MO3) and AHX/HVL. It opens
bounded native file ranges and embeds Rust and the pinned media libraries directly.
No database/profile, browser, webview, JS engine or WASM interpreter is involved.

Build prerequisites and acquisition commands are in the [workspace README](../../README.md).
Windows x64 MSVC is verified through real hardware and clean listening. The
GNU/Linux recipe is retained; its recovery runtime has not been reproduced here.

```powershell
.\libzci\target\release\zci-play.exe "C:\Music\track.opus"
.\libzci\target\release\zci-play.exe --start 15.5 --volume 0.2 --diagnostics "C:\Music\track.opus"
.\libzci\target\release\zci-play.exe --render-pcm out.f32 "C:\Music\track.opus"
```

On GNU/Linux use `libzci/target/release/zci-play` with the same flags.

- `--device NAME`: output-device name substring; defaults to the system device.
- `--volume V`: linear master volume, finite 0.0 through 1.0; default 1.0.
- `--start SECONDS`: finite nonnegative media time; converted by the core.
- `--subsong N`: module subsong index; modules are enabled by default.
  Explicitly rejected for ordinary audio and Opus. `--no-default-features`
  builds a CLI without module support/archives.
- `--diagnostics`: provider, device, audible/decode progress and drain on stderr.
- `--render-pcm FILE`: bounded incremental stereo float32 little-endian PCM at
  48,000 Hz, after the requested fixed master volume, with no audio device.

Render output has no container/header. At EOF its length is exactly
`frames * 2 * 4` bytes. An interrupted or failed render can leave a partial output;
exit status distinguishes that from completion. Existing output files are
replaced; the input path is rejected as an output. For playback of exported PCM:

```sh
ffplay -f f32le -ar 48000 -ac 2 out.f32
# Or: aplay -f FLOAT_LE -c 2 -r 48000 out.f32
```

Exit 0 means completed playback/render (or `--help`), 2 means a typed
usage/media/device/write failure, and 130 means interruption. Ctrl-C is connected
during open, seek, render and playback. Output waits for final media consumption,
including converter tails and device latency; underrun silence does not advance
media time. Already submitted OS audio cannot be recalled on pause or seek.

The production Opus provider supports mapping-family-0 mono/stereo, including
chained streams (mixed layouts normalize to stereo), pre-skip, end trim and
header gain. R128/ReplayGain comments are reported without applying tag gain.
Other Opus mappings and nonseekable/unknown-length sources are typed unsupported
outcomes. The reference defaults bound source size to 1 GiB, links to 1,024,
comments to 64 KiB and each source callback read to 32 KiB.
