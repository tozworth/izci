#!/usr/bin/env bash
# Acquire and natively build reference media libraries for libzci.
#
# Reads pins from libzci/vendor/dependencies.json, downloads exact source
# archives to ignored .local/libzci/vendor/<id>/<release>/, verifies
# sha256 digests, and builds native static libraries separately.
#
# Outputs stay in ignored locations and never overwrite:
#   public/vendor/*, src/lib/vendor/*, or any izci-server asset.
# Browser (Emscripten) builds are pending: no emcc is available in this
# environment; the script records that instead of faking wasm artifacts.
#
# Usage: libzci/scripts/acquire-media-deps.sh [--check-only]
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
  need gcc; need make; need pkg-config
fi

read_pin() {
  # read_pin <id> <field> -> prints field value
  python3 - "$MANIFEST" "$1" "$2" <<'EOF'
import json, sys
manifest = json.load(open(sys.argv[1]))
for lib in manifest["libraries"]:
    if lib["id"] == sys.argv[2]:
        print(lib.get(sys.argv[3], ""))
        break
EOF
}

build_ogg() {
  local id="$1" release="$2" archive="$3" digest="$4"
  local dest="$VENDOR_ROOT/$id/$release"
  local src="$dest/source/libogg-$release"
  local prefix="$dest/$NATIVE_BUILD"
  echo "==> $id $release"
  mkdir -p "$dest/source" "$prefix"
  local tarball="$dest/source/$(basename "$archive")"
  if [[ ! -f "$tarball" ]]; then
    curl -L --fail -o "$tarball" "$archive"
  fi
  echo "$digest  $tarball" | sed 's/^sha256://' | sha256sum -c -
  if [[ ! -d "$src" ]]; then
    tar xzf "$tarball" -C "$dest/source"
  fi
  if [[ "$CHECK_ONLY" == "--check-only" ]]; then
    echo "    check-only: sources verified, native build skipped"
    return
  fi
  if [[ -f "$prefix/lib/libogg.a" ]]; then
    echo "    up to date: $prefix/lib/libogg.a"
    return
  fi
  (
    cd "$src"
    ./configure --disable-shared --enable-static --with-pic "--prefix=$prefix" \
      CFLAGS="-O2 -fPIC"
    make -j"$(nproc)"
    make install
  )
  {
    echo "libogg $release native static build"
    echo "date: $(date -u +%FT%TZ)"
    echo "compiler: $(gcc --version | head -1)"
    echo "configure: ./configure --disable-shared --enable-static --with-pic --prefix=\$prefix CFLAGS=\"-O2 -fPIC\""
    echo "build: make -j + make install"
    echo "archive: $archive"
    echo "digest: sha256:$digest"
  } > "$prefix/BUILD-RECORD.txt"
}

build_opus() {
  local id="$1" release="$2" archive="$3" digest="$4"
  local dest="$VENDOR_ROOT/$id/$release"
  local src="$dest/source/opus-$release"
  local prefix="$dest/$NATIVE_BUILD"
  echo "==> $id $release"
  mkdir -p "$dest/source" "$prefix"
  local tarball="$dest/source/$(basename "$archive")"
  if [[ ! -f "$tarball" ]]; then
    curl -L --fail -o "$tarball" "$archive"
  fi
  echo "$digest  $tarball" | sed 's/^sha256://' | sha256sum -c -
  if [[ ! -d "$src" ]]; then
    tar xzf "$tarball" -C "$dest/source"
  fi
  if [[ "$CHECK_ONLY" == "--check-only" ]]; then
    echo "    check-only: sources verified, native build skipped"
    return
  fi
  if [[ -f "$prefix/lib/libopus.a" ]]; then
    echo "    up to date: $prefix/lib/libopus.a"
    return
  fi
  (
    cd "$src"
    ./configure --disable-shared --enable-static --with-pic "--prefix=$prefix" \
      CFLAGS="-O2 -fPIC"
    make -j"$(nproc)"
    make install
  )
  {
    echo "libopus $release native static build"
    echo "date: $(date -u +%FT%TZ)"
    echo "compiler: $(gcc --version | head -1)"
    echo "configure: ./configure --disable-shared --enable-static --with-pic --prefix=\$prefix CFLAGS=\"-O2 -fPIC\""
    echo "build: make -j + make install"
    echo "archive: $archive"
    echo "digest: sha256:$digest"
  } > "$prefix/BUILD-RECORD.txt"
}

build_opusfile() {
  local id="$1" release="$2" archive="$3" digest="$4"
  local ogg_prefix="$5" opus_prefix="$6"
  local dest="$VENDOR_ROOT/$id/$release"
  local src="$dest/source/opusfile-$release"
  local prefix="$dest/$NATIVE_BUILD"
  echo "==> $id $release"
  mkdir -p "$dest/source" "$prefix"
  local tarball="$dest/source/$(basename "$archive")"
  if [[ ! -f "$tarball" ]]; then
    curl -L --fail -o "$tarball" "$archive"
  fi
  echo "$digest  $tarball" | sed 's/^sha256://' | sha256sum -c -
  if [[ ! -d "$src" ]]; then
    tar xzf "$tarball" -C "$dest/source"
  fi
  if [[ "$CHECK_ONLY" == "--check-only" ]]; then
    echo "    check-only: sources verified, native build skipped"
    return
  fi
  if [[ -f "$prefix/lib/libopusfile.a" ]]; then
    echo "    up to date: $prefix/lib/libopusfile.a"
    return
  fi
  (
    cd "$src"
    export PKG_CONFIG_PATH="$opus_prefix/lib/pkgconfig:$ogg_prefix/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
    ./configure --disable-shared --enable-static --with-pic --disable-http "--prefix=$prefix" \
      CFLAGS="-O2 -fPIC"
    make -j"$(nproc)"
    make install
  )
  {
    echo "libopusfile $release native static build"
    echo "date: $(date -u +%FT%TZ)"
    echo "compiler: $(gcc --version | head -1)"
    echo "configure: ./configure --disable-shared --enable-static --with-pic --disable-http --prefix=\$prefix CFLAGS=\"-O2 -fPIC\""
    echo "env: PKG_CONFIG_PATH pointed at the libogg/libopus build-native prefixes above"
    echo "archive: $archive"
    echo "digest: sha256:$digest"
  } > "$prefix/BUILD-RECORD.txt"
}

for id in libogg libopus libopusfile; do
  release="$(read_pin "$id" pinnedRelease)"
  archive="$(read_pin "$id" archive)"
  digest="$(read_pin "$id" digest)"
  digest="${digest#sha256:}"
  case "$id" in
    libogg) build_ogg "$id" "$release" "$archive" "$digest" ;;
    libopus) build_opus "$id" "$release" "$archive" "$digest" ;;
    libopusfile)
      ogg_release="$(read_pin libogg pinnedRelease)"
      opus_release="$(read_pin libopus pinnedRelease)"
      build_opusfile "$id" "$release" "$archive" "$digest" \
        "$VENDOR_ROOT/libogg/$ogg_release/$NATIVE_BUILD" \
        "$VENDOR_ROOT/libopus/$opus_release/$NATIVE_BUILD"
      ;;
  esac
done

echo "wasm: pending (no Emscripten toolchain in this environment; build-wasm/ intentionally absent)"
echo "done: $VENDOR_ROOT"
