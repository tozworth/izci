# Stage 1 fixture corpus

This directory contains the checked-in fixture contract, not generated media.
The generator writes beneath the ignored `.local/` directory by default:

```sh
node fixtures/generate.mjs
```

Use `--output <directory>` for a disposable test/CDP location. The generator
overwrites only the named files below that location and emits
`generation-report.json`. It verifies every byte count and SHA-256 and fails
closed when the FFmpeg build differs from the manifest pin.

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
