"""CC0 R4 variants of the provenance-backed R3 signals. Only ignored outputs.
Requires existing R3 media and the native zci-play reference executable.
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'.local/libzci/media/r3'
OUT=ROOT/'.local/libzci/media/r4'
OUT.mkdir(parents=True,exist_ok=True)
exe=Path(os.environ.get('ZCI_PLAY',ROOT/'libzci/target/release'/('zci-play.exe' if os.name=='nt' else 'zci-play')))
if not exe.exists(): raise SystemExit('Build native reference first: cargo build --locked --manifest-path libzci/Cargo.toml -p zci-play --release')
table=[]
for n in range(256):
    r=n<<24
    for _ in range(8): r=((r<<1)^0x04c11db7 if r&0x80000000 else r<<1)&0xffffffff
    table.append(r)
def rewrite(data,serial,gain=None):
    data=bytearray(data)
    if gain is not None:
        head=data.index(b'OpusHead');data[head+16:head+18]=gain.to_bytes(2,'little',signed=True)
    at=0
    while at<len(data):
        n=data[at+26];size=27+n+sum(data[at+27:at+27+n])
        data[at+14:at+18]=serial.to_bytes(4,'little');data[at+22:at+26]=b'\0'*4
        crc=0
        for b in data[at:at+size]: crc=((crc<<8)^table[((crc>>24)^b)&255])&0xffffffff
        data[at+22:at+26]=crc.to_bytes(4,'little');at+=size
    return bytes(data)
mono=(SOURCE/'mono.opus').read_bytes();stereo=(SOURCE/'stereo.opus').read_bytes()
(OUT/'gain.opus').write_bytes(rewrite(stereo,42,-6*256))
(OUT/'chain.opus').write_bytes(rewrite(mono,11)+rewrite(stereo,42))
(OUT/'scan.opus').write_bytes(b''.join(rewrite(stereo,i+100) for i in range(1000)))
(OUT/'corrupt.opus').write_bytes(b'not an Ogg Opus file')
(OUT/'truncated.opus').write_bytes(stereo[:100])
bad=bytearray(stereo);head=bad.index(b'OpusHead');bad[head+18]=255
(OUT/'mapping.opus').write_bytes(rewrite(bad,43))
commands=[]
for name in ['mono','stereo','long','gain','chain']:
    source=(SOURCE if name in ['mono','stereo','long'] else OUT)/f'{name}.opus'
    cmd=[str(exe),str(source),'--render-pcm',str(OUT/f'{name}.f32')]
    subprocess.run(cmd,check=True);commands.append(cmd)
for name,start in [('chain',0.3),('stereo',0.625),('stereo',1.250125),('stereo',0.2),('mono',0.05)]:
    source=(SOURCE if name in ['mono','stereo'] else OUT)/f'{name}.opus'
    cmd=[str(exe),str(source),'--start',str(start),'--render-pcm',str(OUT/f'{name}-{round(start*48000)}.f32')]
    subprocess.run(cmd,check=True);commands.append(cmd)
files={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in OUT.iterdir() if p.suffix in ['.opus','.f32']}
(OUT/'provenance.json').write_text(json.dumps({'license':'CC0-1.0','source':'R3 provenance.json; re-CRC chain serials, -6 dB header gain, corruption variants','native_reference':str(exe),'native_sha256':hashlib.sha256(exe.read_bytes()).hexdigest(),'commands':commands,'files':files},indent=2)+'\n')
print(OUT)
