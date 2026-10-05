#!/usr/bin/env bash
# Generate the longer synthetic Opus source for audible playback, seek,
# background, and buffering checks (libzci Phase 1.2).
#
# Output is ignored generated media; this script plus the provenance
# record it writes are the checked-in recipe. Never place private music
# here and never replace the fixtures/ corpus digests.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$REPO_ROOT/.local/libzci/media"
OUT="$OUT_DIR/synth-opus-30s.opus"
mkdir -p "$OUT_DIR"

# 30 s, stereo 48 kHz: left 440 Hz, right 660 Hz, distinct per channel so
# seeks/channel mapping stay observable by ear and by sample inspection.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=30' \
  -f lavfi -i 'sine=frequency=660:sample_rate=48000:duration=30' \
  -filter_complex '[0:a][1:a]amerge=inputs=2[a]' -map '[a]' \
  -map_metadata -1 -fflags +bitexact -flags:a +bitexact \
  -c:a libopus -b:a 64k -vbr off \
  "$OUT"

{
  echo "provenance: project-synthesized dual sine (L=440Hz R=660Hz), CC0-1.0"
  echo "recipe: libzci/tests/synth-opus-30s.sh (ffmpeg 6.1.1-3ubuntu5 pins per fixtures/manifest.json)"
  echo "path: .local/libzci/media/synth-opus-30s.opus"
  sha256sum "$OUT"
  ffprobe -hide_banner -loglevel error -show_entries stream=codec_name,sample_rate,channels,duration \
    -show_entries format=duration -of default=noprint_wrappers=1 "$OUT"
} | tee "$OUT_DIR/synth-opus-30s.provenance.txt"
