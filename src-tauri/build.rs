fn main() {
    tauri_build::build();
    // Tauri emits its Windows manifest for binaries. Native WebView2 smoke
    // examples need the same common-controls manifest to start correctly.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let resources =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("resource.lib");
        println!("cargo:rustc-link-arg-examples={}", resources.display());
    }
}
