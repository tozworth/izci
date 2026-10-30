import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),out=path.join(root,'.local/libzci/media/m3');await mkdir(out,{recursive:true});
const version=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).stdout.split('\n')[0];assert.match(version,/^ffmpeg version 8\.1\.1/);
const commands=[],run=args=>{commands.push(args);const result=spawnSync('ffmpeg',args,{encoding:'utf8'});assert.ifError(result.error);assert.equal(result.status,0,result.stderr);};
run(['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc=size=256x256,noise=alls=100:allf=u','-frames:v','1',path.join(out,'artwork.png')]);
const image=await readFile(path.join(out,'artwork.png'));assert(image.length>65536);
const be=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const picture=Buffer.concat([be(3),be(9),Buffer.from('image/png'),be(0),be(256),be(256),be(24),be(0),be(image.length),image]);
const ffmeta=path.join(out,'artwork.ffmeta');await writeFile(ffmeta,`;FFMETADATA1\nTITLE=With artwork\nLYRICS=[00:01]with art\nR128_TRACK_GAIN=256\nREPLAYGAIN_TRACK_GAIN=-6 dB\nMETADATA_BLOCK_PICTURE=${picture.toString('base64')}\n`);
for(const ext of ['mp3','flac','ogg','opus']) {
  const args=['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=997:sample_rate=48000:duration=4'];
  if(['ogg','opus'].includes(ext))args.push('-f','ffmetadata','-i',ffmeta,'-map_metadata','1');
  else args.push('-i',path.join(out,'artwork.png'),'-map','0:a','-map','1:v','-c:v','copy','-disposition:v','attached_pic','-metadata:s:v','comment=Cover (front)','-metadata','LYRICS=[00:01]with art','-metadata','REPLAYGAIN_TRACK_GAIN=-6 dB');
  args.push(path.join(out,`artwork.${ext}`));run(args);
}
await writeFile(path.join(out,'artwork-recipe.json'),JSON.stringify({version,commands,imageBytes:image.length},null,2));
const server=await createServer({root:path.join(root,'libzci/consumers/crude-pwa'),server:{port:5197,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true,args:['--mute-audio']});const errors=[],results=[];
try {
  const context=await browser.newContext();await context.addInitScript(()=>{window.outputs=0;const A=window.AudioContext;window.AudioContext=class extends A{constructor(...args){super(...args);window.outputs++;}};});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://localhost:5197/?profile=artwork');await page.waitForFunction(()=>!!window.libzci?.snapshot()?.profile);
  for(const ext of ['mp3','flac','ogg','opus']){
    await page.locator('#file').setInputFiles(path.join(out,`artwork.${ext}`));
    const facts=await page.evaluate(async()=>{
      const file=document.querySelector('#file').files[0],api=window.libzci,added=await api.catalogAddFiles([file],[],false),art=await api.catalogArtwork(added.media[0]);
      const bitmap=await createImageBitmap(new Blob([art.bytes],{type:art.info.mime}));const dimensions=[bitmap.width,bitmap.height];bitmap.close();
      return {media:added.media[0],info:art.info,dimensions,bytes:Array.from(art.bytes),lyrics:await api.catalogLyrics(added.media[0]),row:(await api.catalogQuery({media:added.media[0]})).rows[0]};
    });
    assert.equal(facts.info.mime,'image/png');assert.equal(facts.info.picture_type,3);assert.deepEqual(facts.dimensions,[256,256]);assert.deepEqual(Buffer.from(facts.bytes),image);assert.equal(facts.lyrics.lines[0].text,'with art');
    assert.equal(await page.evaluate(()=>window.outputs),0,'probes, artwork and lyric jobs must not create audio output');
    assert.equal((await page.evaluate(()=>window.libzci.snapshot())).snapshot.state,'Idle');
    assert(!JSON.stringify(facts.row).includes(picture.toString('base64').slice(0,128)),'embedded bytes stay outside catalog records');
    results.push({extension:ext,test:'exact embedded PNG bytes and lyrics through output-free worker jobs',bytes:image.length});
  }
  // Large cover tags must not consume the small routine text budget, including
  // optional WebCodecs header parsing, seek and complete real output.
  for(const optional of [false,true]) {
    await page.locator('#file').setInputFiles(path.join(out,'artwork.opus'));await page.locator('#prefer-webcodecs').setChecked(optional);await page.locator('#open').click();await page.waitForFunction(()=>window.libzci.snapshot()?.snapshot.state==='Ready');
    await page.evaluate(()=>window.libzci.command('volume',0.02));await page.evaluate(()=>window.libzci.command('play'));
    await page.waitForFunction(()=>window.libzci.snapshot()?.snapshot.position_frames>12000||window.libzci.snapshot()?.snapshot.error);let observation=await page.evaluate(()=>window.libzci.snapshot());assert.equal(observation.snapshot.error,null);assert.equal(observation.snapshot.provider.id,optional?'browser.webcodecs.opus':'org.xiph.opus');
    assert.equal(observation.snapshot.metadata.some(([key])=>key==='METADATA_BLOCK_PICTURE'),false);
    await page.evaluate(()=>window.libzci.command('seek',2));await page.waitForFunction(()=>window.libzci.snapshot()?.snapshot.state==='Ended'||window.libzci.snapshot()?.snapshot.error,undefined,{timeout:20000});observation=await page.evaluate(()=>window.libzci.snapshot());assert.equal(observation.snapshot.error,null);
    results.push({test:'large Opus picture header preserves real playback, seek, EOF and bounded routine facts',optional});
  }
  const cancelled=await page.evaluate(async()=>{const {ArtworkJob}=await import('/src/artwork-job.ts');const job=new ArtworkJob(document.querySelector('#file').files[0]);job.cancel();try{await job.result;return false;}catch(e){return e.kind==='cancelled';}});assert(cancelled);
  assert.deepEqual(errors,[]);
}finally{await writeFile(path.join(root,'.local/libzci/m3-artwork-evidence.json'),JSON.stringify({results,errors},null,2));await browser.close();await server.close();}
console.log(results);
