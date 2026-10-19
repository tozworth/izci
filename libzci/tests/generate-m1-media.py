"""CC0 M1 audible ordinary audio and tracker recipes. All output is ignored.
Requires FFmpeg 8.1.1. Synthetic tracker byte layouts are generated here; no
third-party music is downloaded. MO3 acquisition is recorded separately.
"""
import hashlib,json,math,struct,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'.local/libzci/media/m1';OUT.mkdir(parents=True,exist_ok=True)
version=subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0]
assert version.startswith('ffmpeg version 8.1.1'),version
commands=[]
for rate,channels in [(44100,1),(48000,2)]:
    for ext,codec in [('wav','pcm_s16le'),('mp3','libmp3lame'),('flac','flac'),('ogg','libvorbis')]:
        cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',f'aevalsrc=0.15*sin(2*PI*(220*t+11*t*t))|0.12*sin(2*PI*(660*t+7*t*t)):s={rate}:d=2.500125','-ac',str(channels),'-map_metadata','-1','-c:a',codec,'-metadata','title=M1 marked tone',str(OUT/f'{rate}-{channels}.{ext}')]
        subprocess.run(cmd,check=True);commands.append(cmd)

sample=bytes(round(math.sin(i*math.pi/16)*96)&255 for i in range(1024))
# MOD: one order, 64 rows, instrument 1 on channel 0, looped sine sample.
mod=bytearray(1084+1024)+sample;mod[:11]=b'M1 tone MOD';mod[42:44]=b'\x02\x00';mod[45]=64;mod[48:50]=b'\x02\x00';mod[950]=1;mod[1080:1084]=b'M.K.';mod[1084:1088]=bytes([1,172,0x10,0]);(OUT/'tone.mod').write_bytes(mod)
# XM: one looped 8-bit delta sample, one pattern, no packing.
xm=bytearray(b'Extended Module: '+b'M1 tone XM'.ljust(20,b'\0')+b'\x1a'+b'libzci CC0'.ljust(20,b'\0')+struct.pack('<HI8H',0x104,276,1,0,4,1,1,1,6,125)+bytes(256))
pattern=bytearray(64*4*5);pattern[:5]=bytes([49,1,0,0,0]);xm+=struct.pack('<IBHH',9,0,64,len(pattern))+pattern
instrument=bytearray(263);struct.pack_into('<I',instrument,0,263);instrument[4:15]=b'M1 sine XM\0';struct.pack_into('<H',instrument,27,1);struct.pack_into('<I',instrument,29,40);xm+=instrument
xm+=struct.pack('<III',1024,0,1024)+bytes([64,0,1,128,0,0])+b'Sine'.ljust(22,b'\0')
prev=0
for b in sample: xm.append((b-prev)&255);prev=b
(OUT/'tone.xm').write_bytes(xm)
# S3M: signed PCM, one channel, one pattern; offsets in paragraphs.
s3m=bytearray(0x400);s3m[:11]=b'M1 tone S3M';s3m[28:30]=bytes([0x1a,16]);struct.pack_into('<6H',s3m,32,1,1,1,0,0x1320,1);s3m[44:48]=b'SCRM';s3m[48:52]=bytes([64,6,125,0xb0]);s3m[64:96]=bytes([0])+bytes([255])*31;s3m[96]=0;struct.pack_into('<HH',s3m,97,0x10,0x20)
inst=memoryview(s3m)[0x100:0x150];inst[0]=1;inst[14:16]=struct.pack('<H',0x40);struct.pack_into('<III',inst,16,1024,0,1024);inst[28]=64;inst[31]=1;struct.pack_into('<I',inst,32,8363);inst[48:55]=b'M1 sine';inst[76:80]=b'SCRS'
del inst
packed=bytes([0x20,0x40,1,0])+bytes(63);struct.pack_into('<H',s3m,0x200,len(packed));s3m[0x202:0x202+len(packed)]=packed;s3m+=sample;(OUT/'tone.s3m').write_bytes(s3m)
# IT sample mode: one order, one sample, one channel/pattern.
it=bytearray(0x400);it[:4]=b'IMPM';it[4:14]=b'M1 tone IT';struct.pack_into('<8H',it,32,1,0,1,1,0x214,0x214,0,0);it[48:54]=bytes([128,48,6,125,128,0]);it[64:128]=bytes([32])*64;it[128:192]=bytes([64])*64;it[192]=0;struct.pack_into('<II',it,193,0x100,0x200)
it[0x100:0x104]=b'IMPS';it[0x111:0x114]=bytes([64,17,64]);it[0x114:0x11b]=b'M1 sine';it[0x12e]=1;it[0x12f]=32;struct.pack_into('<4I',it,0x130,1024,0,1024,8363);struct.pack_into('<I',it,0x148,0x400)
packed=bytes([0x81,3,60,1,0])+bytes(63);struct.pack_into('<HHI',it,0x200,len(packed),64,0);it[0x208:0x208+len(packed)]=packed;it+=sample;(OUT/'tone.it').write_bytes(it)
# MO3 v5: project-authored IT sample-mode song, literal-only valid MO3
# control stream, uncompressed signed PCM. Layout follows pinned Load_mo3.cpp.
mh=bytearray(422);mh[0]=1;struct.pack_into('<6H',mh,1,1,0,1,1,0,1);mh[13:15]=bytes([6,125]);struct.pack_into('<I',mh,15,0x20100);mh[19:22]=bytes([128,128,0]);mh[22:86]=bytes([64])*64;mh[86:150]=bytes([128])*64
track=bytes([0x12,1,60,2,0,0])
ms=bytearray(41);struct.pack_into('<I',ms,0,8363);ms[5]=64;struct.pack_into('<H',ms,6,128);struct.pack_into('<3I',ms,8,1024,0,1024);struct.pack_into('<H',ms,20,0x10);ms[26]=64
music=b'M1 tone MO3\0\0'+mh+bytes([0])+struct.pack('<HHI',0,64,len(track))+track+b'Sine\0\0'+ms
packed=bytearray(music[:1])
for at in range(1,len(music),8): packed+=b'\0'+music[at:at+8]
(OUT/'tone.mo3').write_bytes(b'MO3\x05'+struct.pack('<II',len(music),len(packed))+packed+sample)
# Hively: synth instrument with a fixed square waveform performance entry.
for hvl in [False,True]:
    length=16 if hvl else 14
    header=bytearray(length);header[:4]=b'HVL\x01' if hvl else b'THX\x01';header[6:8]=bytes([0x80,1]);header[10]=16;header[11]=1;header[12]=1
    if hvl: header[14:16]=bytes([100,2])
    positions=bytes([1,0])+bytes(6)
    if hvl:
        track=bytes([25,1,0,0,0])+bytes([0x3f])*15
    else:
        track=bytes([(25<<2),0x10,0])+bytes(15*3)
    ins=bytearray(22);ins[0]=64;ins[1]=3;ins[2:6]=bytes([1,64,1,64]);ins[6]=64;ins[7:9]=bytes([1,64]);ins[12]=32;ins[15]=32;ins[16]=32;ins[17]=63;ins[20:22]=bytes([1,1])
    perf=bytes([0,0x80|25,0,0]) if not hvl else bytes([0,2,0x80|25,0,0])
    data=header+positions+track+ins+perf
    struct.pack_into('>H',data,4,len(data));data+=b'M1 audible square\0Square\0'
    (OUT/('tone.hvl' if hvl else 'tone.ahx')).write_bytes(data)
files={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in OUT.iterdir() if p.suffix!='.json'}
(OUT/'provenance.json').write_text(json.dumps({'license':'CC0-1.0','recipe':'libzci/tests/generate-m1-media.py','ffmpeg':version,'commands':commands,'files':files},indent=2)+'\n')
print(OUT)
