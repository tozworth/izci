// Real decoder -> shared renderer -> AudioWorklet, always with Chromium muted.
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),out=path.join(root,'.local/libzci/media/m3');await mkdir(out,{recursive:true});
const version=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).stdout.split('\n')[0];assert.match(version,/^ffmpeg version 8\.1\.1/);
const commands=[];
for(const extension of ['mp3','flac','ogg','opus']){
  const args=['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=997:sample_rate=48000:duration=12','-metadata','REPLAYGAIN_TRACK_GAIN=-6 dB','-metadata','REPLAYGAIN_ALBUM_GAIN=-12 dB','-metadata','REPLAYGAIN_TRACK_PEAK=0.5','-metadata','REPLAYGAIN_ALBUM_PEAK=0.5'];
  if(extension==='opus')args.push('-metadata','R128_TRACK_GAIN=256','-metadata','R128_ALBUM_GAIN=-256');
  args.push(path.join(out,`normalization.${extension}`));const run=spawnSync('ffmpeg',args,{encoding:'utf8'});assert.ifError(run.error);assert.equal(run.status,0,run.stderr);commands.push(args);
}
const trim=['-hide_banner','-loglevel','error','-y','-i',path.join(out,'normalization.opus'),'-t','1','-c:a','copy',path.join(out,'normalization-first.opus')];
assert.equal(spawnSync('ffmpeg',trim,{encoding:'utf8'}).status,0);commands.push(trim);
const second=await readFile(path.join(out,'normalization.opus')),tag='R128_TRACK_GAIN=256',tagAt=second.indexOf(tag);assert(tagAt>=0);second.write('512',tagAt+tag.length-3,'ascii');
for(let at=0;at<second.length;){const laces=second[at+26],length=27+laces+second.subarray(at+27,at+27+laces).reduce((a,b)=>a+b,0);second.writeUInt32LE(42,at+14);second.fill(0,at+22,at+26);let crc=0;for(const byte of second.subarray(at,at+length)){crc^=byte<<24;for(let bit=0;bit<8;bit++)crc=(crc<<1)^((crc&0x80000000)?0x04c11db7:0);}second.writeUInt32LE(crc>>>0,at+22);at+=length;}
await writeFile(path.join(out,'normalization-chain.opus'),Buffer.concat([await readFile(path.join(out,'normalization-first.opus')),second]));
await writeFile(path.join(out,'normalization-recipe.json'),JSON.stringify({version,commands,chain:'first link trimmed to 1s; second R128_TRACK_GAIN changed from 256 to 512; second serial 42 and Ogg CRCs recomputed'},null,2));
const server=await createServer({root:path.join(root,'libzci/consumers/crude-pwa'),server:{port:5197,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true,args:['--mute-audio']});const results=[],errors=[];
const wait=async(page,predicate,arg)=>{try{await page.waitForFunction(predicate,arg,{timeout:30000});}catch(e){console.error(JSON.stringify(await page.evaluate(()=>({o:window.libzci?.snapshot(),log:document.querySelector('#diagnostics')?.textContent})),null,2));throw e;}};
async function level(page) {
  const start=await page.evaluate(()=>window.libzci.snapshot().output.media??0);
  // Discard output around the setting change, then measure a stationary tone
  // from coherent worklet media/energy counters, independent of UI polling rate.
  await wait(page,n=>window.libzci.snapshot()?.output.media>n+4096,start);
  const a=await page.evaluate(()=>window.libzci.snapshot().output);
  await wait(page,n=>window.libzci.snapshot()?.output.media>n+8192,a.media);
  const b=await page.evaluate(()=>window.libzci.snapshot().output);
  return Math.sqrt((b.energy-a.energy)/(2*(b.media-a.media)));
}
try {
  for(const [extension,optional] of [['opus',false],['opus',true],['mp3',false],['flac',false],['ogg',false]]){
    const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(`http://localhost:5197/?profile=normalization-${extension}-${optional}`);await wait(page,()=>!!window.libzci?.snapshot()?.profile);
    await page.evaluate(()=>window.libzci.command('volume',0.02));
    await page.locator('#file').setInputFiles(path.join(out,`normalization.${extension}`));await page.locator('#prefer-webcodecs').setChecked(optional);await page.locator('#open').click();
    await wait(page,()=>window.libzci.snapshot()?.snapshot.state==='Ready');await page.evaluate(()=>window.libzci.command('play'));
    const base=await level(page);assert(base>0&&base<0.01);
    if(optional)assert.equal((await page.evaluate(()=>window.libzci.snapshot())).snapshot.provider.id,'browser.webcodecs.opus');
    await page.locator('#normalization-mode').selectOption('track');await page.locator('#normalization-apply').click();
    const trackDb=extension==='opus'?6:-6;
    await wait(page,db=>Math.abs(window.libzci.snapshot()?.snapshot.normalization.gain_db-db)<1e-5,trackDb);
    const track=await level(page),expectedTrack=10**(trackDb/20);assert(Math.abs(track/base/expectedTrack-1)<0.015,`${extension} track signal: ${track/base} vs ${expectedTrack}`);
    await page.evaluate(()=>window.libzci.command('mute',1));const muted=await level(page);assert.equal(muted,0);await page.evaluate(()=>window.libzci.command('mute',0));
    await page.locator('#normalization-mode').selectOption('album');await page.locator('#normalization-preamp_db').fill('-2');await page.locator('#normalization-apply').click();
    const albumDb=extension==='opus'?2:-14;
    await wait(page,db=>Math.abs(window.libzci.snapshot()?.snapshot.normalization.gain_db-db)<1e-5,albumDb);
    const album=await level(page),expectedAlbum=10**(albumDb/20);assert(Math.abs(album/base/expectedAlbum-1)<0.015,`${extension} album signal: ${album/base} vs ${expectedAlbum}`);
    await page.evaluate(()=>window.libzci.command('pause'));
    const prior=await page.evaluate(()=>window.libzci.snapshot().profile);
    const rejected=await page.evaluate(async()=>{const p=window.libzci.snapshot().profile;try{await window.libzci.queue({kind:'settings',settings:{...p.settings,replay_gain:{...p.settings.replay_gain,preamp_db:1000}}});return false;}catch{return true;}});assert(rejected);
    assert.equal((await page.evaluate(()=>window.libzci.snapshot().profile)).revision,prior.revision);
    await page.reload();await wait(page,()=>window.libzci?.snapshot()?.profile?.settings.replay_gain.mode==='album');
    assert.equal((await page.evaluate(()=>window.libzci.snapshot())).snapshot.replay_gain.preamp_db,-2);
    results.push({extension,optional,base,trackRatio:track/base,expectedTrack,albumRatio:album/base,expectedAlbum,test:'real output normalization, mute, controls, invalid-setting rollback and SQL reopen'});
    await context.close();
  }
  const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://localhost:5197/?profile=normalization-chain');await wait(page,()=>!!window.libzci?.snapshot()?.profile);
  await page.evaluate(()=>window.libzci.command('volume',0.02));await page.locator('#normalization-mode').selectOption('track');await page.locator('#normalization-apply').click();
  await page.locator('#file').setInputFiles(path.join(out,'normalization-chain.opus'));
  const facts=await page.evaluate(async()=>{const {ProbeWorker}=await import('/src/probe-worker.ts');const worker=new ProbeWorker();try{return await worker.inspect(document.querySelector('#file').files[0],false);}finally{worker.close();}});
  assert.equal(facts.normalization_points.length,2);assert.equal(facts.normalization_points[0].tags.r128_track_gain_q8,256);assert.equal(facts.normalization_points[1].tags.r128_track_gain_q8,512);
  const catalog=await page.evaluate(async()=>{const added=await window.libzci.catalogAddFiles([document.querySelector('#file').files[0]],[],false);return window.libzci.catalogQuery({media:added.media[0]});});assert.equal(catalog.rows[0].metadata.replay_gain.r128_track_gain_q8,256);
  await page.locator('#open').click();await wait(page,()=>window.libzci.snapshot()?.snapshot.state==='Ready');await page.evaluate(()=>window.libzci.command('play'));
  const first=await level(page);await wait(page,boundary=>window.libzci.snapshot()?.snapshot.position_frames>boundary+4096,facts.normalization_points[1].source_frame);
  await wait(page,()=>window.libzci.snapshot()?.snapshot.normalization.gain_db===7);const later=await level(page);assert(Math.abs(later/first/(10**(1/20))-1)<0.015);
  await page.evaluate(()=>window.libzci.command('pause'));await page.locator('#normalization-preamp_db').fill('-3');await page.locator('#normalization-apply').click();
  await page.evaluate(seconds=>window.libzci.command('seek',seconds),(facts.normalization_points[1].source_frame+9600)/48000);await wait(page,()=>!window.libzci.snapshot()?.snapshot.pending_operation&&window.libzci.snapshot()?.snapshot.normalization.gain_db===4);await page.evaluate(()=>window.libzci.command('play'));
  const seeked=await level(page);assert(Math.abs(seeked/later/(10**(-3/20))-1)<0.015);await page.evaluate(()=>window.libzci.command('pause'));
  results.push({test:'chained Opus scoped tags, first-link catalog facts, gain at audible boundaries and seek priming with changed settings',boundary:facts.normalization_points[1].source_frame,ratio:later/first,seekRatio:seeked/later});
  await context.close();assert.deepEqual(errors,[]);
}finally{await browser.close();await server.close();}
await writeFile(path.join(root,'.local/libzci/m3-normalization-evidence.json'),JSON.stringify(results,null,2));console.log(results);
