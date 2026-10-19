"""Pinned independent OpenMPT/Hively Emscripten module provider."""
import importlib.util, json, os, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('acq',Path(__file__).with_name('acquire-module-sources.py'))
acq=importlib.util.module_from_spec(spec);spec.loader.exec_module(acq)
env=os.environ.copy();em=Path(env.get('EMSDK',ROOT/'.local/libzci/emsdk'))/'upstream/emscripten'
env['PATH']=str(em)+os.pathsep+env['PATH']
subprocess.run([sys.executable,str(Path(__file__).with_name('build-module-deps.py')),'--browser'],check=True,env=env)
mpt,md,_=acq.acquire('libopenmpt');hvl,hd,_=acq.acquire('hivelytracker-replay')
out=ROOT/'libzci/consumers/crude-pwa/src/generated';out.mkdir(exist_ok=True)
exports=['_zcm_'+s for s in ['create','close','probe_step','total','position','read','seek_step','control','fact','text','cell']]+['_malloc','_free']
subprocess.run([sys.executable,str(em/'em++.py'),'-O3','-std=c++17','-fexceptions',
    '-I'+str(mpt),'-I'+str(ROOT/'libzci/crates/libzci-codecs/c'),str(ROOT/'libzci/crates/libzci-codecs/c/modules_browser.cpp'),
    str(md/'build-emscripten-4.0.10/lib/libopenmpt.a'),str(hd/'build-emscripten-4.0.10/lib/libhivelycontext.a'),
    '-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=worker','-sFILESYSTEM=0','-sSTACK_SIZE=1048576',
    '-sINITIAL_MEMORY=134217728','-sMAXIMUM_MEMORY=268435456','-sALLOW_MEMORY_GROWTH=1','-sABORTING_MALLOC=0',
    '-sEXPORTED_FUNCTIONS='+json.dumps(exports),'-sEXPORTED_RUNTIME_METHODS=["ccall","UTF8ToString","HEAPU8","HEAPF32"]',
    '-o',str(out/'modules-reference.js')],check=True,env=env)
(out/'modules-reference.d.ts').write_text('export default function create(options: Record<string, unknown>): Promise<any>;\n')
