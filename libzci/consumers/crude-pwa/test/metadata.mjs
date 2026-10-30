import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const out=path.join(root,'.local/libzci/media/m3');await mkdir(out,{recursive:true});
const version=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).stdout.split('\n')[0];assert.match(version,/^ffmpeg version 8\.1\.1/);
const output=path.join(out,'tagged.opus');
const command=['-hide_banner','-loglevel','error','-y','-i',path.join(root,'.local/libzci/media/r3/mono.opus'),'-c:a','copy','-metadata','title=Çığ / 曲','-metadata','artist=İzci','-metadata','album=Metadata fixture','-metadata','lyrics=[00:00.100]Transient lyric payload','-metadata','REPLAYGAIN_TRACK_GAIN=-3 dB',output];
const encoded=spawnSync('ffmpeg',command,{encoding:'utf8'});assert.equal(encoded.status,0,encoded.stderr);
await writeFile(path.join(out,'metadata-recipe.json'),JSON.stringify({version,command},null,2));
const server=await createServer({root:path.join(root,'libzci/consumers/crude-pwa'),server:{port:5197,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true,args:['--mute-audio']});const results=[];
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{window.audioContexts=0;const Original=window.AudioContext;window.AudioContext=class extends Original{constructor(...args){super(...args);window.audioContexts++;}};});
  await page.goto('http://localhost:5197/?profile=metadata-test');await page.waitForFunction(()=>window.libzci?.snapshot()?.profile);
  await page.locator('#file').setInputFiles(output);
  const facts=await page.evaluate(async()=>{
    const {ProbeWorker}=await import('/src/probe-worker.ts');const worker=new ProbeWorker();const file=document.querySelector('#file').files[0];
    try{const first=await worker.inspect(file,false);const second=await worker.inspect(file,false);return {first,second};}finally{worker.close();}
  });
  for(const inspected of [facts.first,facts.second]){
    const tags=Object.fromEntries(inspected.comments);
    assert.equal(tags.TITLE,'Çığ / 曲');assert.equal(tags.ARTIST,'İzci');assert.equal(tags.LYRICS,'[00:00.100]Transient lyric payload');assert.equal(tags.REPLAYGAIN_TRACK_GAIN,'-3 dB');assert.equal(tags.R128_TRACK_GAIN,'256');
  }
  const catalog=await page.evaluate(async()=>{const file=document.querySelector('#file').files[0];const added=await window.libzci.catalogAddFiles([file],[],false);return window.libzci.catalogQuery({media:added.media[0]});});
  assert.equal(catalog.rows[0].metadata.title,'Çığ / 曲');assert.equal(catalog.rows[0].metadata.artist,'İzci');assert(!JSON.stringify(catalog).includes('Transient lyric payload'),'embedded lyrics are not durable catalog metadata');
  assert.equal(await page.evaluate(()=>window.audioContexts),0);
  results.push({test:'bounded Opus tag leases, UTF-8, reusable probe contexts, core normalization and transient lyrics',comments:facts.first.comments.length});
  assert.deepEqual(errors,[]);
  const bytes=await readFile(output);assert(bytes.length<64*1024); // genuinely small synthetic media
}finally{await browser.close();await server.close();}
await writeFile(path.join(root,'.local/libzci/m3-metadata-evidence.json'),JSON.stringify(results,null,2));console.log(results);
