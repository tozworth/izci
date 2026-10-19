"""Build pinned module archives for MSVC or Emscripten, without old izci assets.
Run from a configured MSVC environment; --browser uses EMSDK 4.0.10.
The source set/defines follow upstream's small-library GNU Makefile.
"""
import argparse, importlib.util, json, os, subprocess
from pathlib import Path
spec = importlib.util.spec_from_file_location('acquire', Path(__file__).with_name('acquire-module-sources.py'))
acq = importlib.util.module_from_spec(spec); spec.loader.exec_module(acq)
ROOT = acq.ROOT
browser = argparse.ArgumentParser(); browser.add_argument('--browser', action='store_true'); args = browser.parse_args()
env = os.environ.copy()
target = 'emscripten-4.0.10' if args.browser else subprocess.check_output(['rustc','-vV'], text=True).split('host: ')[1].splitlines()[0]
if not args.browser and target != 'x86_64-pc-windows-msvc': raise SystemExit('Use acquire-module-deps.sh for GNU/Linux.')
em = Path(env.get('EMSDK', ROOT/'.local/libzci/emsdk'))/'upstream/emscripten'
if args.browser: env['PATH'] = str(em)+os.pathsep+env['PATH']
def run(*a): subprocess.run([str(x) for x in a], check=True, env=env)
for name in ['libopenmpt','hivelytracker-replay']:
    src,dest,pin = acq.acquire(name)
    prefix = dest/f'build-{target}'; build = dest/f'cmake-{target}'
    project = dest/f'project-{target}'; project.mkdir(exist_ok=True)
    q = lambda p: '"'+str(p).replace('\\','/')+'"'
    if name == 'libopenmpt':
        patterns = ['src/openmpt/all/*.cpp','src/openmpt/base/*.cpp','src/openmpt/logging/*.cpp',
            'src/openmpt/random/*.cpp','common/*.cpp','src/openmpt/fileformat_base/*.cpp',
            'src/openmpt/soundbase/*.cpp','src/openmpt/soundfile_data/*.cpp','soundlib/*.cpp',
            'soundlib/plugins/*.cpp','soundlib/plugins/dmo/*.cpp','sounddsp/*.cpp','libopenmpt/*.cpp']
        files = [p for pattern in patterns for p in sorted(src.glob(pattern))]
        files += [src/f for f in ['include/miniz/miniz.c','include/minimp3/minimp3.c','include/stb_vorbis/stb_vorbis.c']]
        includes = [src, src/'src', src/'common', src/'include']
        defs = ['LIBOPENMPT_BUILD','MPT_WITH_MINIZ','MPT_WITH_MINIMP3','MPT_WITH_STBVORBIS',
            'STB_VORBIS_NO_PULLDATA_API','STB_VORBIS_NO_STDIO','MINIMP3_ONLY_MP3','MINIMP3_NO_STDIO']
        lib = 'openmpt'
    else:
        files = [src/'hvl2wav/replay.c',ROOT/'libzci/crates/libzci-codecs/c/hively_context.c']
        includes = [src/'hvl2wav', ROOT/'libzci/crates/libzci-codecs/c']; defs=[]; lib='hivelycontext'
    cmake = '\n'.join(['cmake_minimum_required(VERSION 3.20)', 'project(zci_module LANGUAGES C CXX)',
        'set(CMAKE_CXX_STANDARD 17)', 'set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreadedDLL)',
        f'add_library({lib} STATIC '+ ' '.join(map(q,files))+')',
        f'target_include_directories({lib} PRIVATE '+' '.join(map(q,includes))+')',
        f'target_compile_definitions({lib} PRIVATE '+' '.join(defs)+')',
        f'if(MSVC)\ntarget_compile_options({lib} PRIVATE /utf-8 /EHsc /bigobj /wd4996)\nendif()',
        f'install(TARGETS {lib} ARCHIVE DESTINATION lib)'])
    (project/'CMakeLists.txt').write_text(cmake+'\n')
    flags = [f'-DCMAKE_TOOLCHAIN_FILE={em}/cmake/Modules/Platform/Emscripten.cmake'] if args.browser else []
    run('cmake','-S',project,'-B',build,'-G','Ninja',f'-DCMAKE_INSTALL_PREFIX={prefix}','-DCMAKE_BUILD_TYPE=Release',*flags)
    run('cmake','--build',build,'--parallel','4'); run('cmake','--install',build)
    (prefix/'BUILD-RECORD.txt').write_text(json.dumps({'target':target,'pin':pin,'recipe':'build-module-deps.py','sourceFiles':[str(p.relative_to(src)) if p.is_relative_to(src) else str(p.relative_to(ROOT)) for p in files]},indent=2)+'\n')
