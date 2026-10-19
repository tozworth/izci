#!/usr/bin/env bash
# Keep shell and Windows recipes on the same isolated two-build implementation.
set -euo pipefail
exec python "$(dirname "${BASH_SOURCE[0]}")/build-wasm.py"
