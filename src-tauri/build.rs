fn main() {
    build_signaling();
    println!("cargo:rerun-if-changed=icons/file-types/manifest.json");
    let icons: serde_json::Value =
        serde_json::from_str(include_str!("icons/file-types/manifest.json")).unwrap();
    let mut windows = tauri_build::WindowsAttributes::new();
    for icon in icons.as_array().unwrap() {
        let name = icon["name"].as_str().unwrap();
        let id = icon["resourceId"].as_u64().unwrap();
        let path = format!("icons/file-types/{name}.ico");
        println!("cargo:rerun-if-changed={path}");
        let path = std::env::current_dir().unwrap().join(path);
        assert!(path.is_file(), "Run npm run desktop:icons");
        let path = path.to_string_lossy().replace('\\', "\\\\");
        windows = windows.append_rc_content(format!("{id} ICON \"{path}\"\n"));
    }
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("Compile desktop resources");
    // Tauri emits its Windows manifest for binaries. Native WebView2 smoke
    // examples need the same common-controls manifest to start correctly.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let resources =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("resource.lib");
        println!("cargo:rustc-link-arg-examples={}", resources.display());
    }
}

fn build_signaling() {
    let server = std::env::current_dir().unwrap().join("../izci-server");
    for path in ["cmd/izci-desktop-signal", "internal", "go.mod", "go.sum"] {
        println!("cargo:rerun-if-changed={}", server.join(path).display());
    }
    let output =
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("izci-signal.exe");
    let status = std::process::Command::new("go")
        .current_dir(&server)
        .env("CGO_ENABLED", "0")
        .env("GOOS", "windows")
        .env("GOARCH", "amd64")
        .args(["build", "-trimpath", "-ldflags=-s -w -H=windowsgui", "-o"])
        .arg(output)
        .arg("./cmd/izci-desktop-signal")
        .status()
        .expect("Install Go to build the embedded desktop signaling server");
    assert!(status.success(), "Build the embedded signaling-only server");
}
