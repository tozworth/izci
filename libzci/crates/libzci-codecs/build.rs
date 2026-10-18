//! Build script: link the pinned reference static builds.
//!
//! The libraries themselves are produced by
//! `libzci/scripts/acquire-media-deps.sh` (libopus 1.5.2) and
//! `libzci/scripts/acquire-module-deps.sh` (libopenmpt 0.8.4,
//! hively context) from the `libzci/vendor/dependencies.json` pins.
//! This script only points rustc at the prebuilt archives; it never
//! downloads, builds, or overwrites frontend/server assets. Run the
//! acquisition scripts first — the panic messages say so.

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

fn link_prestatic(id: &str, lib: &str, script: &str) {
    let release = manifest_field(id, "pinnedRelease");
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target = std::env::var("TARGET").unwrap();
    let prefix = manifest_dir
        .join("../../../.local/libzci/vendor")
        .join(id)
        .join(&release)
        .join(format!("build-{target}"));
    let archive = prefix.join("lib").join(if target.ends_with("msvc") {
        format!("{lib}.lib")
    } else {
        format!("lib{lib}.a")
    });
    if !archive.is_file() {
        panic!(
            "missing pinned {id} {release} static build at {}.\n\
             Run `{script}` first (see libzci/vendor/dependencies.json).",
            archive.display()
        );
    }
    println!("cargo:rerun-if-changed={}", archive.display());
    println!(
        "cargo:rustc-link-search=native={}",
        prefix.join("lib").display()
    );
    println!("cargo:rustc-link-lib=static={lib}");
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../vendor/dependencies.json");
    let target = std::env::var("TARGET").unwrap();
    let media_recipe = if target.ends_with("msvc") {
        "powershell -File libzci/scripts/acquire-media-deps.ps1"
    } else {
        "libzci/scripts/acquire-media-deps.sh"
    };
    if std::env::var_os("CARGO_FEATURE_OPUS").is_some() {
        link_prestatic("libopusfile", "opusfile", media_recipe);
        link_prestatic("libopus", "opus", media_recipe);
        link_prestatic("libogg", "ogg", media_recipe);
        if !target.contains("windows") {
            println!("cargo:rustc-link-lib=m");
        }
    }
    if std::env::var_os("CARGO_FEATURE_MODULES").is_some() {
        link_prestatic(
            "libopenmpt",
            "openmpt",
            "libzci/scripts/acquire-module-deps.sh",
        );
        link_prestatic(
            "hivelytracker-replay",
            "hivelycontext",
            "libzci/scripts/acquire-module-deps.sh",
        );
        if target.contains("linux") || target.ends_with("windows-gnu") {
            println!("cargo:rustc-link-lib=stdc++");
        } else if target.contains("apple") {
            println!("cargo:rustc-link-lib=c++");
        }
    }
}
