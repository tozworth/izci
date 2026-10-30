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
const longLyrics=Array.from({length:300},(_,n)=>`[${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}.100]Line ${n} Çığ 曲`).join('\n');
const containers=['mp3','flac','ogg','opus'];const commands=[command];
for(const extension of containers){
  const input=extension==='opus'?path.join(root,'.local/libzci/media/r3/mono.opus'):path.join(root,`.local/libzci/media/m1/44100-1.${extension}`);
  const args=['-hide_banner','-loglevel','error','-y','-i',input,'-c:a','copy','-metadata',`lyrics=${longLyrics}`,path.join(out,`lyrics.${extension}`)];
  const process=spawnSync('ffmpeg',args,{encoding:'utf8'});assert.equal(process.status,0,process.stderr);commands.push(args);
}
await writeFile(path.join(out,'metadata-recipe.json'),JSON.stringify({version,commands},null,2));
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
    assert.equal(tags.TITLE,'Çığ / 曲');assert.equal(tags.ARTIST,'İzci');assert.equal(tags.LYRICS,undefined,'routine provider facts omit embedded lyric payloads');assert.equal(tags.REPLAYGAIN_TRACK_GAIN,'-3 dB');assert.equal(tags.R128_TRACK_GAIN,'256');
  }
  const catalog=await page.evaluate(async()=>{const file=document.querySelector('#file').files[0];const added=await window.libzci.catalogAddFiles([file],[],false);return window.libzci.catalogQuery({media:added.media[0]});});
  assert.equal(catalog.rows[0].metadata.title,'Çığ / 曲');assert.equal(catalog.rows[0].metadata.artist,'İzci');assert(!JSON.stringify(catalog).includes('Transient lyric payload'),'embedded lyrics are not durable catalog metadata');
  assert.equal(await page.evaluate(()=>window.audioContexts),0);
  results.push({test:'bounded Opus tag leases, UTF-8, reusable probe contexts, core normalization and transient lyrics',comments:facts.first.comments.length});
  const lyricIds={};
  for(const extension of containers){
    await page.locator('#file').setInputFiles(path.join(out,`lyrics.${extension}`));
    const lyrics=await page.evaluate(async()=>{const {LyricsJob}=await import('/src/lyrics-job.ts');return new LyricsJob(document.querySelector('#file').files[0]).result;});
    assert.equal(lyrics.lines.length,300,`${extension} complete embedded lyrics beyond provider comment truncation`);assert.equal(lyrics.lines[299].text,'Line 299 Çığ 曲');assert.equal(lyrics.lines[299].time_ms,299100);
    const added=await page.evaluate(()=>window.libzci.catalogAddFiles([document.querySelector('#file').files[0]],[],false));
    lyricIds[extension]=added.media[0];
    const throughProfile=await page.evaluate(media=>window.libzci.catalogLyrics(media),added.media[0]);assert.equal(throughProfile.raw,lyrics.raw);
    results.push({test:'shared ranged on-demand lyrics without a decoder/output',extension,cues:lyrics.lines.length});
  }
  assert.equal(await page.evaluate(()=>window.audioContexts),0);
  await page.locator('#catalog-refresh').click();await page.waitForFunction(()=>document.querySelectorAll('#catalog-rows tr').length===5);
  await page.locator('#catalog-rows button').filter({hasText:'Lyrics'}).first().click();await page.waitForFunction(()=>document.querySelector('#lyrics-status')?.textContent?.includes('Loaded transient lyrics'));
  const cancel=await page.evaluate(async()=>{const {LyricsJob}=await import('/src/lyrics-job.ts');const job=new LyricsJob(document.querySelector('#file').files[0]),result=job.result.catch(e=>String(e));job.cancel();return result;});assert(cancel.includes('cancelled'));
  const selected=await page.evaluate(media=>window.libzci.catalogQuery({media}),lyricIds.opus);
  await page.locator('#catalog-rows tr').filter({hasText:'lyrics.opus'}).getByRole('button',{name:'Lyrics',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#lyrics-rows button').length===300);
  await page.evaluate(async source=>{await window.libzci.command('volume',0.02);await window.libzci.queue({kind:'append',sources:[source]});await window.libzci.queue({kind:'next',ended:false});},selected.rows[0].source);
  await page.waitForFunction(()=>window.libzci.snapshot()?.snapshot.position_frames>=4800&&document.querySelectorAll('#lyrics-rows [aria-current]').length===1);
  await page.evaluate(()=>window.libzci.command('pause'));await page.locator('#lyrics-delay').fill('1');await page.locator('#lyrics-delay').dispatchEvent('change');await page.waitForFunction(()=>!document.querySelector('#lyrics-rows [aria-current]'));
  await page.locator('#lyrics-delay').fill('0');await page.locator('#lyrics-delay').dispatchEvent('change');await page.waitForFunction(()=>!!document.querySelector('#lyrics-rows [aria-current]'));
  assert(!(await page.evaluate(()=>window.libzci.snapshot().snapshot.metadata)).some(([key])=>key==='LYRICS'),'automatic transport snapshots omit embedded payloads');
  const transport=await page.evaluate(()=>window.libzci.snapshot().snapshot);
  await page.locator('#catalog-rows tr').filter({hasText:'lyrics.mp3'}).getByRole('button',{name:'Lyrics',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#lyrics-rows [aria-current]'));
  assert.equal((await page.evaluate(()=>window.libzci.snapshot().snapshot)).generation,transport.generation,'viewing another source lyrics does not replace music');
  results.push({test:'lyrics UI follows the audible clock, isolates source identity and clears delayed highlights'});
  assert.deepEqual(errors,[]);
  const bytes=await readFile(output);assert(bytes.length<64*1024); // genuinely small synthetic media
}finally{await browser.close();await server.close();}
await writeFile(path.join(root,'.local/libzci/m3-metadata-evidence.json'),JSON.stringify(results,null,2));console.log(results);
