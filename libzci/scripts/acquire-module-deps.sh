#!/usr/bin/env bash
# Acquire and natively build module sources for libzci (Phase 1.4).
#
# Reads pins from libzci/vendor/dependencies.json, downloads exact source
# archives to ignored .local/libzci/vendor/<id>/<release>/, verifies
# sha256 digests, and builds native static libraries:
#   - libopenmpt 0.8.4 via its own GNU Makefile (static lib only, bundled
#     miniz/minimp3/stb_vorbis, no mpg123 — the same feature set the
#     checked-in browser WASM reports);
#   - hively context objects: upstream hvl2wav/replay.c plus the new
#     instance-safe libzci-codecs/c/hively_context.c wrapper, compiled
#     with gcc into one static archive.
#
# Outputs stay in ignored locations and never overwrite:
#   public/vendor/*, src/lib/vendor/*, or any izci-server asset.
# Emscripten builds are pending: no emcc is available in this
# environment; the script records that instead of faking wasm artifacts.
#
# Usage: libzci/scripts/acquire-module-deps.sh [--check-only]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$REPO_ROOT/libzci/vendor/dependencies.json"
VENDOR_ROOT="$REPO_ROOT/.local/libzci/vendor"
CHECK_ONLY="${1:-}"
need_target="${LIBZCI_TARGET:-$(rustc -vV | sed -n 's/^host: //p')}"
[[ "$need_target" == *-linux-gnu ]] || { echo "This recipe requires native GNU/Linux. For Windows MSVC use acquire-media-deps.ps1." >&2; exit 1; }
NATIVE_BUILD="build-$need_target"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }; }
need python3; need curl; need sha256sum; need tar
if [[ "$CHECK_ONLY" != "--check-only" ]]; then
  need gcc; need g++; need make
fi

read_pin() {
  python3 - "$MANIFEST" "$1" "$2" <<'EOF'
import json, sys
manifest = json.load(open(sys.argv[1]))
for lib in manifest["libraries"]:
    if lib["id"] == sys.argv[2]:
        print(lib.get(sys.argv[3], ""))
        break
EOF
}

fetch_source() {
  # fetch_source <id> <release> <archive> <digest> <topdir> -> prints source dir
  local id="$1" release="$2" archive="$3" digest="$4" topdir="$5"
  local dest="$VENDOR_ROOT/$id/$release"
  mkdir -p "$dest/source"
  local tarball="$dest/source/$(basename "$archive")"
  if [[ ! -f "$tarball" ]]; then
    curl -L --fail -o "$tarball" "$archive"
  fi
  echo "$digest  $tarball" | sed 's/^sha256://' | sha256sum -c - > /dev/null
  if [[ ! -d "$dest/source/$topdir" ]]; then
    tar xzf "$tarball" -C "$dest/source"
  fi
  echo "$dest/source/$topdir"
}

OPENMPT_RELEASE="$(read_pin libopenmpt pinnedRelease)"
OPENMPT_ARCHIVE="$(read_pin libopenmpt archive)"
OPENMPT_DIGEST="$(read_pin libopenmpt digest)"; OPENMPT_DIGEST="${OPENMPT_DIGEST#sha256:}"
HIVELY_RELEASE="$(read_pin hivelytracker-replay pinnedRelease)"
HIVELY_ARCHIVE="$(read_pin hivelytracker-replay archive)"
HIVELY_DIGEST="$(read_pin hivelytracker-replay digest)"; HIVELY_DIGEST="${HIVELY_DIGEST#sha256:}"

echo "==> libopenmpt $OPENMPT_RELEASE"
OPENMPT_SRC="$(fetch_source libopenmpt "$OPENMPT_RELEASE" "$OPENMPT_ARCHIVE" "$OPENMPT_DIGEST" "openmpt-libopenmpt-$OPENMPT_RELEASE")"
OPENMPT_PREFIX="$VENDOR_ROOT/libopenmpt/$OPENMPT_RELEASE/$NATIVE_BUILD"
if [[ "$CHECK_ONLY" == "--check-only" ]]; then
  echo "    check-only: sources verified, native build skipped"
else
  if [[ -f "$OPENMPT_PREFIX/lib/libopenmpt.a" ]]; then
    echo "    up to date: $OPENMPT_PREFIX/lib/libopenmpt.a"
  else
    mkdir -p "$OPENMPT_PREFIX"
    (
      cd "$OPENMPT_SRC"
      make -j"$(nproc)" bin/libopenmpt.a \
        NO_ZLIB=1 NO_MPG123=1 NO_OGG=1 NO_VORBIS=1 NO_VORBISFILE=1
    )
    mkdir -p "$OPENMPT_PREFIX/lib" "$OPENMPT_PREFIX/include"
    cp "$OPENMPT_SRC/bin/libopenmpt.a" "$OPENMPT_PREFIX/lib/"
    cp "$OPENMPT_SRC/libopenmpt/libopenmpt.h" "$OPENMPT_SRC/libopenmpt/libopenmpt_ext.h" "$OPENMPT_PREFIX/include/"
    {
      echo "libopenmpt $OPENMPT_RELEASE native static build"
      echo "date: $(date -u +%FT%TZ)"
      echo "compiler: $(g++ --version | head -1)"
      echo "build: make bin/libopenmpt.a NO_ZLIB=1 NO_MPG123=1 NO_OGG=1 NO_VORBIS=1 NO_VORBISFILE=1"
      echo "features: bundled miniz/minimp3/stb_vorbis, no mpg123 (matches checked-in WASM report)"
      echo "archive: $OPENMPT_ARCHIVE"
      echo "digest: sha256:$OPENMPT_DIGEST"
    } > "$OPENMPT_PREFIX/BUILD-RECORD.txt"
  fi
fi

echo "==> hivelytracker-replay $HIVELY_RELEASE"
HIVELY_SRC="$(fetch_source hivelytracker-replay "$HIVELY_RELEASE" "$HIVELY_ARCHIVE" "$HIVELY_DIGEST" "hivelytracker-$HIVELY_RELEASE")"
HIVELY_PREFIX="$VENDOR_ROOT/hivelytracker-replay/$HIVELY_RELEASE/$NATIVE_BUILD"
if [[ "$CHECK_ONLY" == "--check-only" ]]; then
  echo "    check-only: sources verified, native build skipped"
else
  if [[ -f "$HIVELY_PREFIX/lib/libhivelycontext.a" ]]; then
    WRAPPER="$REPO_ROOT/libzci/crates/libzci-codecs/c"
    if [[ "$HIVELY_PREFIX/lib/libhivelycontext.a" -nt "$WRAPPER/hively_context.c" ]] \
      && [[ "$HIVELY_PREFIX/lib/libhivelycontext.a" -nt "$WRAPPER/hively_context.h" ]]; then
      echo "    up to date: $HIVELY_PREFIX/lib/libhivelycontext.a"
    else
      echo "    wrapper changed: rebuilding"
      rm -f "$HIVELY_PREFIX/lib/libhivelycontext.a" "$HIVELY_PREFIX/obj/"*.o
    fi
  fi
  if [[ ! -f "$HIVELY_PREFIX/lib/libhivelycontext.a" ]]; then
    mkdir -p "$HIVELY_PREFIX/lib" "$HIVELY_PREFIX/obj"
    REPLAY="$HIVELY_SRC/hvl2wav"
    WRAPPER="$REPO_ROOT/libzci/crates/libzci-codecs/c"
    gcc -O2 -fPIC -Wall -I"$REPLAY" -I"$WRAPPER" \
      -c "$REPLAY/replay.c" -o "$HIVELY_PREFIX/obj/replay.o"
    gcc -O2 -fPIC -Wall -I"$REPLAY" -I"$WRAPPER" \
      -c "$WRAPPER/hively_context.c" -o "$HIVELY_PREFIX/obj/hively_context.o"
    ar rcs "$HIVELY_PREFIX/lib/libhivelycontext.a" \
      "$HIVELY_PREFIX/obj/replay.o" "$HIVELY_PREFIX/obj/hively_context.o"
    {
      echo "hively context native static build"
      echo "date: $(date -u +%FT%TZ)"
      echo "compiler: $(gcc --version | head -1)"
      echo "build: gcc -O2 -fPIC -Wall replay.c hively_context.c -> libhivelycontext.a"
      echo "upstream: hvl2wav/replay.c at $HIVELY_RELEASE (unmodified)"
      echo "wrapper: libzci/crates/libzci-codecs/c/hively_context.c (instance-safe contexts)"
      echo "archive: $HIVELY_ARCHIVE"
      echo "digest: sha256:$HIVELY_DIGEST"
    } > "$HIVELY_PREFIX/BUILD-RECORD.txt"
  fi
fi

echo "Browser modules: python libzci/scripts/build-browser-modules.py (pinned Emscripten 4.0.10)"
echo "done: $VENDOR_ROOT"
