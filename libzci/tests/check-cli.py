"""Process-level R3 exits and interruption checks. Generate R3 media first.

Set ZCI_PLAY to test a release executable. Hardware output must be authorized.
"""
import json
import os
import pathlib
import signal
import subprocess
import threading
import time

root = pathlib.Path(__file__).resolve().parents[2]
default_exe = root / 'libzci/target/debug' / ('zci-play.exe' if os.name == 'nt' else 'zci-play')
exe = pathlib.Path(os.environ.get('ZCI_PLAY', default_exe))
media = root / '.local/libzci/media/r3'
report = {}


def run(name, args, interrupt=False, ready_file=None):
    started = time.monotonic()
    process = subprocess.Popen(
        [str(exe), *map(str, args)], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0,
    )
    playing = threading.Event()
    stderr = []

    def read_stderr():
        for line in iter(process.stderr.readline, b''):
            stderr.append(line)
            if b'zci-play: playing ' in line:
                playing.set()

    reader = threading.Thread(target=read_stderr, daemon=True)
    reader.start()
    if interrupt:
        if ready_file:
            deadline = time.monotonic() + 5
            while not ready_file.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.001)
            assert ready_file.exists(), 'render never opened its incremental sink'
        else:
            assert playing.wait(5), 'playback did not start'
        interrupted = time.monotonic()
        process.send_signal(signal.CTRL_BREAK_EVENT if os.name == 'nt' else signal.SIGINT)
    process.wait(timeout=10)
    reader.join(timeout=1)
    stdout = process.stdout.read()
    result = {
        'exit': process.returncode, 'seconds': time.monotonic() - started,
        'stdout_bytes': len(stdout), 'stderr': b''.join(stderr).decode(errors='replace')[-1000:],
    }
    report[name] = result
    if interrupt:
        result['interrupt_seconds'] = time.monotonic() - interrupted
        assert result['interrupt_seconds'] < 1.0, result
    expected = 130 if interrupt else (0 if name in ('help', 'start_render') else 2)
    assert process.returncode == expected, (name, result)
    assert not stdout, (name, result)


run('help', ['--help'])
run('missing', [media / 'no-file.opus'])
run('usage', ['--volume', 'nan', media / 'long.opus'])
run('corrupt', [root / 'AGENTS.md'])
run('unknown_device', ['--device', 'no-such-device', media / 'mono.opus'])
run('start_render', ['--start', '15.5', '--volume', '.5', '--render-pcm', media / 'start.f32', media / 'long.opus'])
assert (media / 'start.f32').stat().st_size == 696006 * 8
run('play_interrupt', ['--volume', '0', media / 'long.opus'], interrupt=True)
partial = media / 'cancel.f32'
partial.unlink(missing_ok=True)
run('render_interrupt', ['--render-pcm', partial, media / 'interruption.opus'], interrupt=True, ready_file=partial)
(root / '.local/libzci/cli-evidence.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
for name, result in report.items():
    print(name, result['exit'], round(result.get('interrupt_seconds', result['seconds']), 4))
