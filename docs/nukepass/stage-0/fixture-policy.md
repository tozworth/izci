# Fixture and test-data policy

The fixture corpus is deterministic, tiny, redistributable, and sufficient to
identify a media path—not a collection of copyrighted songs. Every fixture row
records provenance/license, creation command or source digest, expected format
facts, expected duration/rate/channels where meaningful, tags/artwork/lyrics,
and whether corruption is deliberate.

## Required corpus

- MP3, WAV, FLAC, Ogg Vorbis, and Opus regular audio.
- MOD, XM, S3M, IT, and MO3 OpenMPT modules.
- AHX and HVL Hively modules.
- MP4, WebM, and MKV video, with M4V/MOV represented by format-policy tests or a
  separately justified tiny fixture.
- Valid unknown-extension module, unsupported unknown file, truncated/corrupt
  media, metadata variants, embedded artwork, plain and timestamped lyrics, and
  changed-file revisions.
- Synthetic nested folder trees, duplicates, stable-path replacements, and
  programmable granted/prompt/denied/unavailable handle states.

Generated tones, simple test frames, metadata containers, folder trees, and
corrupt byte sequences are preferred when a pinned local generator can reproduce
them. Format fixtures that cannot be generated from repository tooling must be
small assets with an explicit permissive/public-domain source and SHA-256.

## Storage and execution

- Manifests and generators are committed. Binary fixtures are committed only
  when generation is impractical and redistribution is documented.
- Generated output lives below an ignored temporary/artifact directory and is
  recreated for clean verification; tests never depend on a developer library.
- Fixture handles enter through the same application-facing capability contract
  as native handles. They do not bypass collection, materialization, permission,
  metadata, or playback business paths.
- Deterministic clocks, IDs, and network behavior are allowed in unit/simulation
  suites. Final CDP media paths use real browser timing and decoding.
- Native picker, restored-handle, installed-PWA, and physical output checks stay
  on the manual/device list even when equivalent failure states are injected.

The Stage 1 corpus manifest records the fixtures that can be produced with the
current toolchain and explicitly marks any format gap rather than silently using
an unlicensed sample.
