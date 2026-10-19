"""Digest-verified module sources shared by native and Emscripten recipes."""
import hashlib, json, tarfile, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
PINS = json.loads((ROOT/'libzci/vendor/dependencies.json').read_text())
def acquire(name):
    pin = next(p for p in PINS['libraries'] if p['id'] == name)
    dest = ROOT/'.local/libzci/vendor'/name/pin['pinnedRelease']
    archive = dest/'source'/pin['archive'].split('/')[-1]
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists(): urllib.request.urlretrieve(pin['archive'], archive)
    digest = 'sha256:'+hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != pin['digest']: raise SystemExit(f'Digest mismatch: {archive}')
    with tarfile.open(archive) as tar:
        folder = tar.getmembers()[0].name.split('/')[0]
        src = archive.parent/folder
        if not src.exists(): tar.extractall(archive.parent, filter='data')
    return src, dest, pin
if __name__ == '__main__':
    for name in ['libopenmpt','hivelytracker-replay']:
        print(name, acquire(name)[0])
