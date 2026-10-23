"""Process-level opt-in profile/settings/render proof; no audio device."""
import json, os, sqlite3, struct, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[2]
local=root/'.local/libzci'; local.mkdir(parents=True,exist_ok=True)
exe=Path(os.environ.get('ZCI_PLAY',root/'libzci/target/debug'/('zci-play.exe' if os.name=='nt' else 'zci-play')))
media=root/'.local/libzci/media/r3/mono.opus'
results=[]
with tempfile.TemporaryDirectory(prefix='m2-cli-',dir=local) as temporary:
    work=Path(temporary).resolve();assert work.is_relative_to(local.resolve())
    profile=work/'profile'; output=work/'render.f32'
    def run(*args):
        p=subprocess.run([str(exe),*map(str,args),str(media)],cwd=work,capture_output=True,text=True,timeout=15)
        assert p.returncode==0,(p.returncode,p.stderr)
    run('--render-pcm',output)
    assert not profile.exists() and not (work/'.local').exists()
    results.append('default CLI remains transient')
    run('--profile',profile,'--volume','0.23','--render-pcm',output)
    run('--profile',profile,'--render-pcm',output)
    db=sqlite3.connect(profile/'profile.sqlite3')
    settings=json.loads(db.execute("SELECT value FROM domain_settings WHERE key='playback'").fetchone()[0])
    assert settings['volume']==0.23
    assert db.execute('SELECT count(*),count(DISTINCT id) FROM queue_occurrences').fetchone()==(2,2)
    assert db.execute('SELECT count(*) FROM source_references').fetchone()[0]==1
    results.append('explicit profile reopens settings and appends duplicate occurrences')
    settings['mute']=True
    db.execute("UPDATE domain_settings SET value=? WHERE key='playback'",(json.dumps(settings),));db.commit();db.close()
    run('--profile',profile,'--render-pcm',output)
    samples=struct.unpack('<'+'f'*(output.stat().st_size//4),output.read_bytes())
    assert len(samples)>0 and max(map(abs,samples))==0
    results.append('saved master mute applies to device-free CLI rendering')
(local/'m2-cli-evidence.json').write_text(json.dumps({'results':results},indent=2)+'\n')
print('\n'.join(results))
