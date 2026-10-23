# libzci dependency notices

Exact Rust package versions and registry checksums are in `Cargo.lock`.
Pinned C archives, SHA-256 digests, upstream source links and licenses are in
`vendor/dependencies.json`. Recipes preserve source archives and original
license files under the ignored `.local/libzci/vendor/` tree.

The M1 native and browser consumers include:

- Symphonia 0.5.5 and its enabled codec/container crates: **MPL-2.0**.
  Source: <https://github.com/pdeljanov/Symphonia/tree/v0.5.5>; the exact
  published sources are also available from crates.io using `Cargo.lock`.
  The provider uses the published, unmodified library. Keep its license and
  source availability notice with redistributed builds.
- libopus 1.5.2, libopusfile 0.12, libogg 1.3.5: **BSD-3-Clause**;
  upstream `COPYING` files contain the copyright notices and terms.
- libopenmpt 0.8.4: **BSD-3-Clause**, including additional bundled component
  notices in the upstream sources and this repository's
  `docs/THIRD-PARTY-NOTICES.md`. The small-library
  build uses bundled miniz, minimp3 and stb_vorbis. Preserve the full upstream
  notices when distributing these media builds.
- HivelyTracker replay at `f393ca7c6416f00bcb574b334a7e8b57dcb19eb2`:
  **BSD-3-Clause**, Pete Gordon and contributors. The repository's existing
  `public/vendor/hivelytracker-LICENSE.txt` contains its notice and terms.
- eframe/egui: **MIT OR Apache-2.0**; rfd: **MIT**. These are native presentation
  dependencies. CPAL and rtrb supply native output/queue mechanisms; their
  upstream license files and other transitive Rust notices accompany their
  exact registry sources.

No third-party music is bundled. M1 audio and tracker fixtures are synthesized
by `tests/generate-m1-media.py` and dedicated to the public domain under CC0-1.0.

M2 persistence adds:

- rusqlite 0.32.1 / libsqlite3-sys 0.30.1: **MIT** bindings to bundled,
  public-domain SQLite. Exact sources and checksums are in `Cargo.lock`.
- `@sqlite.org/sqlite-wasm` 3.54.1-build1: **Apache-2.0** packaging of the
  official, unmodified SQLite WASM distribution, whose SQLite code is public
  domain. Source: <https://github.com/sqlite/sqlite-wasm>; preserve the package's
  LICENSE and distribution notices. Exact archive integrity is in the crude
  PWA's `package-lock.json`. The SAH-pool files are separate from media/grants.
