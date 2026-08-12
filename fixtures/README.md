# Stage 1 fixture corpus

This directory contains the checked-in fixture contract, not generated media.
The generator writes beneath the ignored `.local/` directory by default:

```sh
node fixtures/generate.mjs
```

Use `--output <directory>` for a disposable test/CDP location. The generator
overwrites only the named files below that location and emits
`generation-report.json`. It verifies every byte count and SHA-256, then uses
the paired pinned FFprobe to validate containers, codecs, duration tolerance,
audio shape and revision frequency, video dimensions/rate, tags, front-cover
artwork, plain/LRC lyric structure, MOD/libopenmpt
acceptance, and corrupt/unsupported rejection. The command fails closed when
either binary is missing or differs from the manifest pin.

The exact acquisition target is Ubuntu 24.04 (Noble) package
`ffmpeg=7:6.1.1-3ubuntu5` from the Ubuntu `universe` repository. That package
provides both `ffmpeg` and `ffprobe`; confirm their complete first version lines
against `manifest.json`. The generator also requires every encoder named in
`toolchain.ffmpeg.requiredEncoders`. On another distribution or architecture,
use a container/image that installs that exact Noble package rather than
accepting new digests from a different codec build. `IZCI_FIXTURE_FFMPEG` and
`IZCI_FIXTURE_FFPROBE` may point to the matching binaries.

Manifest-shape and logical-fixture tests do not need FFmpeg. The integration
case runs only when the complete pinned toolchain is detected and otherwise
appears as an intentional Vitest skip with the mismatch reason. This skip does
not relax the generator command: invoking `node fixtures/generate.mjs` without
the pin remains an error.

The corpus contains synthetic audio/video, one Node-built ProTracker module, an
unknown-extension copy of that module, unsupported and deliberately corrupt
bytes, metadata with embedded artwork, plain/timestamped lyric tokens, changed
revisions, and a nested duplicate/stable-path tree. `logicalFixtures` defines
the revision sequence and programmable granted/prompt/denied/unavailable handle
states for capability-boundary adapters; it is not an alternate collection or
materialization path.

The manifest's `requiredCoverage` is deliberately candid. XM, S3M, IT, MO3,
AHX, and HVL remain gaps until there is either a pinned deterministic generator
or a tiny verified permissive/public-domain source. No developer music library
or unlicensed sample is an acceptable substitute.
