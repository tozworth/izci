#!/usr/bin/env bash
# Build the libzci-web WASM module and its JS glue for the crude PWA.
#
# Outputs (ignored, generated): consumers/crude-pwa/src/generated/
# Requires: wasm32-unknown-unknown target + matching wasm-bindgen CLI
# (see libzci/vendor/dependencies.json toolchain note for versions).
set -euo pipefail

CONSUMER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$CONSUMER_ROOT/../../.." && pwd)"
OUT="$CONSUMER_ROOT/src/generated"

: "${WASM_BINDGEN:=wasm-bindgen}"
command -v "$WASM_BINDGEN" >/dev/null 2>&1 || {
  echo "missing wasm-bindgen CLI (tried \$WASM_BINDGEN='$WASM_BINDGEN')" >&2
  echo "install the pinned CLI first: cargo install wasm-bindgen-cli --version <wasm-bindgen crate version>" >&2
  exit 1
}

cargo build --manifest-path "$REPO_ROOT/libzci/Cargo.toml" \
  -p libzci-web --target wasm32-unknown-unknown --release

WASM="$REPO_ROOT/libzci/target/wasm32-unknown-unknown/release/libzci_web.wasm"
mkdir -p "$OUT"
"$WASM_BINDGEN" --target web --out-dir "$OUT" --out-name libzci_web "$WASM"
ls -la "$OUT"
