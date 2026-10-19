"""Build independent Rust control and import-free audio WASM artifacts."""
from pathlib import Path
import re
import shutil
import subprocess

root = Path(__file__).resolve().parents[4]
out = root / 'libzci/consumers/crude-pwa/src/generated'
out.mkdir(parents=True, exist_ok=True)
lock = (root / 'libzci/Cargo.lock').read_text()
version = re.search(r'name = "wasm-bindgen"\nversion = "([^"]+)"', lock)[1]
actual = subprocess.check_output(['wasm-bindgen', '--version'], text=True).strip()
if actual != f'wasm-bindgen {version}':
    raise SystemExit(f'Install matching CLI: cargo install wasm-bindgen-cli --version {version} --locked')
for package in ['libzci-web', 'libzci-audio-web']:
    subprocess.run(['cargo', 'build', '--locked', '--manifest-path', str(root / 'libzci/Cargo.toml'),
        '-p', package, '--target', 'wasm32-unknown-unknown', '--release'], check=True)
wasm = root / 'libzci/target/wasm32-unknown-unknown/release'
subprocess.run(['wasm-bindgen', '--target', 'web', '--out-dir', str(out), '--out-name', 'libzci_web', str(wasm / 'libzci_web.wasm')], check=True)
shutil.copyfile(wasm / 'libzci_audio_web.wasm', out / 'libzci_audio_web.wasm')
