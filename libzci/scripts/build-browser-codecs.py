"""Pinned reference browser codec recipe. Requires emsdk 4.0.10, CMake/Ninja.
All acquisition/build output is isolated under .local/libzci; emitted files go
only to the crude consumer's ignored generated directory. No global SDK changes.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
PINS = json.loads((ROOT / 'libzci/vendor/dependencies.json').read_text())
SDK = Path(os.environ.get('EMSDK', ROOT / '.local/libzci/emsdk'))
EM = SDK / 'upstream/emscripten'
env = os.environ.copy()
env['EMSDK'] = str(SDK)
env['PATH'] = str(EM) + os.pathsep + env['PATH']

def run(*args):
    subprocess.run([str(a) for a in args], check=True, env=env)

emcc = EM / 'emcc.py'
version = subprocess.check_output(['python', str(emcc), '--version'], env=env, text=True)
if ' 4.0.10 ' not in version:
    raise SystemExit('Requires Emscripten 4.0.10: emsdk install 4.0.10 && emsdk activate 4.0.10')
prefixes = {}
sources = {}
for name, folder in [('libogg', 'libogg-1.3.5'), ('libopus', 'opus-1.5.2'), ('libopusfile', 'opusfile-0.12')]:
    pin = next(p for p in PINS['libraries'] if p['id'] == name)
    dest = ROOT / '.local/libzci/vendor' / name / pin['pinnedRelease']
    archive = dest / 'source' / pin['archive'].split('/')[-1]
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        urllib.request.urlretrieve(pin['archive'], archive)
    digest = 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != pin['digest']:
        raise SystemExit(f'Digest mismatch: {archive}')
    src = archive.parent / folder
    if not src.exists():
        with tarfile.open(archive) as tar:
            tar.extractall(archive.parent, filter='data')
    prefix = dest / 'build-emscripten-4.0.10'
    prefix.mkdir(parents=True, exist_ok=True)
    sources[name] = src
    prefixes[name] = prefix
    if name != 'libopusfile':
        build = dest / 'cmake-emscripten-4.0.10'
        run('cmake', '-S', src, '-B', build, '-G', 'Ninja',
            f'-DCMAKE_TOOLCHAIN_FILE={EM}/cmake/Modules/Platform/Emscripten.cmake',
            f'-DCMAKE_INSTALL_PREFIX={prefix}', '-DCMAKE_BUILD_TYPE=Release',
            '-DCMAKE_POLICY_VERSION_MINIMUM=3.5', '-DBUILD_SHARED_LIBS=OFF',
            '-DBUILD_TESTING=OFF', '-DINSTALL_DOCS=OFF', '-DOPUS_BUILD_TESTING=OFF',
            '-DOPUS_BUILD_PROGRAMS=OFF', '-DOPUS_INSTALL_PKG_CONFIG_MODULE=OFF',
            '-DCMAKE_C_FLAGS=-O3')
        run('cmake', '--build', build, '--parallel', '4')
        run('cmake', '--install', build)
    (prefix / 'BUILD-RECORD.txt').write_text(f'{name} {pin["pinnedRelease"]}\n{digest}\n{version}\nAsyncify; no HTTP/TLS; recipe: build-browser-codecs.py\n')

out = ROOT / 'libzci/consumers/crude-pwa/src/generated'
out.mkdir(parents=True, exist_ok=True)
src = sources['libopusfile']
exports = ['_zci_' + s for s in ['create', 'open', 'total', 'position', 'read', 'seek', 'close']] + ['_malloc', '_free']
run('python', emcc, '-O3', '-DOP_DISABLE_HTTP',
    f'-I{src}/include', f'-I{prefixes["libogg"]}/include', f'-I{prefixes["libopus"]}/include/opus',
    ROOT / 'libzci/crates/libzci-codecs/c/opus_browser.c',
    *[src / 'src' / f'{s}.c' for s in ['info', 'internal', 'opusfile', 'stream']],
    prefixes['libopus'] / 'lib/libopus.a', prefixes['libogg'] / 'lib/libogg.a',
    '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=worker', '-sFILESYSTEM=0',
    '-sASYNCIFY=1', '-sASYNCIFY_STACK_SIZE=131072', '-sSTACK_SIZE=1048576',
    '-sINITIAL_MEMORY=33554432', '-sALLOW_MEMORY_GROWTH=0', '-sABORTING_MALLOC=0',
    '-sEXPORTED_FUNCTIONS=' + json.dumps(exports), '-sEXPORTED_RUNTIME_METHODS=["ccall","HEAPU8","HEAPF32"]',
    '-o', out / 'opus-reference.js')
(out / 'opus-reference.d.ts').write_text('export default function create(options: Record<string, unknown>): Promise<any>;\n')
print('Built reference opusfile 0.12 / opus 1.5.2 / ogg 1.3.5 (Emscripten 4.0.10)')
