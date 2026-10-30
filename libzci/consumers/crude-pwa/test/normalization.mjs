// Real decoder -> shared renderer -> AudioWorklet, always with Chromium muted.
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
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
await writeFile(path.join(out,'normalization-recipe.json'),JSON.stringify({version,commands},null,2));
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
  assert.deepEqual(errors,[]);
}finally{await browser.close();await server.close();}
await writeFile(path.join(root,'.local/libzci/m3-normalization-evidence.json'),JSON.stringify(results,null,2));console.log(results);
