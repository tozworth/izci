"""R3 generated media, independent of the existing pinned frontend corpus.
Requires FFmpeg 8.1.1. Writes only ignored .local/libzci/media/r3 files and a
provenance report with exact binary/version, commands and output SHA256 values.
"""
import hashlib, json, pathlib, subprocess, shutil
root = pathlib.Path(__file__).resolve().parents[2]
out = root / '.local/libzci/media/r3'
out.mkdir(parents=True, exist_ok=True)
version = subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0]
assert version.startswith('ffmpeg version 8.1.1'), f'Requires FFmpeg 8.1.1, found {version}'
report = {'ffmpeg_binary_sha256': hashlib.sha256(pathlib.Path(shutil.which('ffmpeg')).read_bytes()).hexdigest(), 'license': 'CC0-1.0 (project-generated synthetic signals)', 'ffmpeg': version, 'commands': [], 'files': {}}
def run(args):
    command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args
    subprocess.run(command, check=True)
    report['commands'].append(command)
for name, duration, channels in [('mono', '0.250125', '1'), ('stereo', '1.250125', '2'), ('long', '30.000125', '2')]:
    # Stereo uses different changing tones in L/R so dropped/reordered media is visible.
    signal = f'aevalsrc=0.15*sin(2*PI*(220*t+11*t*t))|0.12*sin(2*PI*(660*t+7*t*t)):s=48000:d={duration}'
    run(['-f','lavfi','-i',signal,'-map_metadata','-1','-fflags','+bitexact','-flags:a','+bitexact','-ac',channels,'-c:a','libopus','-b:a','96k','-metadata','R128_TRACK_GAIN=256','-metadata','REPLAYGAIN_TRACK_GAIN=-3 dB',str(out / f'{name}.opus')])
    run(['-c:a','libopus','-i',str(out / f'{name}.opus'),'-f','f32le','-acodec','pcm_f32le',str(out / f'{name}.f32')])
run(['-stream_loop','19','-i',str(out/'long.opus'),'-c','copy',str(out/'interruption.opus')])
for name in ('mono.opus','mono.f32','stereo.opus','stereo.f32','long.opus','long.f32','interruption.opus'):
    file = out/name
    report['files'][name] = {'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
(out / 'provenance.json').write_text(json.dumps(report, indent=2) + '\n')
print(out)
