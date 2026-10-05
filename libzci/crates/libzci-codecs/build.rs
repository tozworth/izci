//! Build script: link the pinned reference libopus static build.
//!
//! The library itself is produced by `libzci/scripts/acquire-media-deps.sh`
//! from the `libzci/vendor/dependencies.json` pin (libopus 1.5.2,
//! `--disable-shared`). This script only points rustc at the prebuilt
//! archive; it never downloads, builds, or overwrites frontend/server
//! assets. Run the acquisition script first — the panic message says so.

use std::path::PathBuf;

fn manifest_field(id: &str, field: &str) -> String {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vendor/dependencies.json");
    let text = std::fs::read_to_string(&manifest)
        .unwrap_or_else(|e| panic!("read {}: {e}", manifest.display()));
    // Minimal field lookup without new dependencies: find the "id" block,
    // then the first `"field": "value"` inside it.
    let id_key = format!("\"id\": \"{id}\"");
    let id_pos = text
        .find(&id_key)
        .unwrap_or_else(|| panic!("{id} missing from dependencies.json"));
    let after = &text[id_pos..];
    let field_key = format!("\"{field}\": \"");
    let field_pos = after
        .find(&field_key)
        .unwrap_or_else(|| panic!("{field} missing for {id}"));
    let value_start = field_pos + field_key.len();
    let value_end = after[value_start..]
        .find('"')
        .unwrap_or_else(|| panic!("unterminated {field} for {id}"));
    after[value_start..value_start + value_end].to_string()
}

fn main() {
    let release = manifest_field("libopus", "pinnedRelease");
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let prefix = manifest_dir.join("../../../.local/libzci/vendor/libopus").join(&release).join("build-native");
    let lib = prefix.join("lib").join("libopus.a");
    if !lib.is_file() {
        panic!(
            "missing pinned libopus {release} static build at {}.\n\
             Run `libzci/scripts/acquire-media-deps.sh` first (see libzci/vendor/dependencies.json).",
            lib.display()
        );
    }
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../vendor/dependencies.json");
    println!("cargo:rustc-link-search=native={}", prefix.join("lib").display());
    println!("cargo:rustc-link-lib=static=opus");
}
