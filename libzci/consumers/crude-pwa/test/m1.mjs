// Real File/provider/worklet coverage on an isolated, temporary Chromium profile.
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const media=path.join(root,'.local/libzci/media/m1');
const cli=process.env.ZCI_PLAY??path.join(root,'libzci/target/debug/zci-play.exe');
const server=await createServer({root:path.join(root,'libzci/consumers/crude-pwa'),server:{port:5197,strictPort:true}});await server.listen();
const results=[];let browser;
try {
  browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>Object.defineProperty(globalThis,'AudioDecoder',{value:undefined,configurable:true}));
  await page.goto('http://localhost:5197');
  const wait=async predicate=>{try{await page.waitForFunction(predicate,undefined,{timeout:20000});}catch(e){console.error(JSON.stringify(await page.evaluate(()=>({snapshot:window.libzci.snapshot(),errors:document.querySelector('#diagnostics')?.textContent})),null,2));throw e;}};
  const snap=()=>page.evaluate(()=>window.libzci.snapshot());
  const command=async(kind,value=0)=>{
    const before=(await snap()).snapshot.revision;
    await page.evaluate(([k,v])=>window.libzci.command(k,v),[kind,value]);
    await page.waitForFunction(r=>window.libzci.snapshot()?.snapshot.revision>r&&!window.libzci.snapshot()?.snapshot.pending_operation,before,{timeout:15000});
  };
  for(const name of ['44100-1.wav','44100-1.mp3','44100-1.flac','44100-1.ogg','48000-2.wav','48000-2.mp3','48000-2.flac','48000-2.ogg','tone.mod','tone.xm','tone.s3m','tone.it','tone.mo3','tone.ahx','tone.hvl']) {
    await page.locator('#file').setInputFiles(path.join(media,name));await page.locator('#open').click();
    await page.waitForFunction(name=>window.libzci.snapshot()?.sourceName===name&&window.libzci.snapshot()?.snapshot.state==='Ready',name,{timeout:15000});const opened=await snap();
    assert.equal(opened.snapshot.error,null);assert(opened.snapshot.total_frames>0,name);
    await command('play');await wait(()=>window.libzci.snapshot()?.output.energy>0&&window.libzci.snapshot()?.snapshot.position_frames>1000);
    await command('pause');await wait(()=>window.libzci.snapshot()?.snapshot.requested==='Held');
    const held=(await snap()).snapshot.position_frames;await page.waitForTimeout(60);assert.equal((await snap()).snapshot.position_frames,held);
    if(name.startsWith('tone')) {
      assert(opened.snapshot.module?.cells.length>0,`${name} bounded pattern query`);
      for(const [kind,value] of [['interpolation',2],['channel-mute',0],['channel-unmute',0],['subsong',0]]) {
        await command(kind,value);await wait(()=>!window.libzci.snapshot()?.snapshot.pending_operation);assert.equal((await snap()).snapshot.error,null,`${name} ${kind}`);
      }
      if(opened.snapshot.capabilities.speed) {
        for(const [kind,value] of [['ramping',4],['speed',1.25],['pitch',0.75],['loops',1],['loops',0],['speed',1],['pitch',1]]) {
          await command(kind,value);await wait(()=>!window.libzci.snapshot()?.snapshot.pending_operation);assert.equal((await snap()).snapshot.error,null,`${name} ${kind}`);
        }
      } else assert(await page.locator('[data-module="speed"]').isDisabled());
      const [probe,render]=await page.evaluate(()=>Promise.all([window.libzci.job('probe'),window.libzci.job('render')]));
      assert.equal(probe.facts.provider.id,opened.snapshot.provider.id);assert(render.peak>0.05);assert(render.frames>0);
      results.push({name,probeFrames:probe.facts.total,renderFrames:render.frames,renderPeak:render.peak});
    }
    await command('seek',0.373);await wait(()=>!window.libzci.snapshot()?.snapshot.pending_operation);assert.equal((await snap()).snapshot.error,null);
    const current=(await snap()).snapshot;await command('seek',current.total_frames/current.sample_rate-0.05);await wait(()=>!window.libzci.snapshot()?.snapshot.pending_operation);
    await command('play');await wait(()=>window.libzci.snapshot()?.snapshot.state==='Ended');
    const ended=(await snap()).snapshot;if(ended.position_frames!==ended.total_frames)console.error(JSON.stringify(await snap(),null,2));assert.equal(ended.position_frames,ended.total_frames,`${name} final consumption`);
    results.push({name,test:'real output / pause / seek / controls / EOF',provider:opened.snapshot.provider,frames:ended.position_frames});
    console.log('passed output:',name);
  }
  assert.deepEqual(errors,[]);
  await page.locator('#file').setInputFiles({name:'tone.unknown',mimeType:'application/octet-stream',buffer:await readFile(path.join(media,'tone.mod'))});
  await page.locator('#open').click();await page.waitForFunction(()=>window.libzci.snapshot()?.sourceName==='tone.unknown'&&window.libzci.snapshot()?.snapshot.state==='Ready');
  const declined=await page.evaluate(async()=>{try{await window.libzci.job('probe');return '';}catch(e){return String(e);}});assert(declined.includes('unsupported'));
  const verified=await page.evaluate(()=>window.libzci.job('probe',true));assert.equal(verified.facts.provider.id,'org.openmpt.libopenmpt');
  const cancelled=await page.evaluate(async()=>{const p=window.libzci.job('render');window.libzci.cancelJobs();try{await p;return '';}catch(e){return String(e);}});assert(cancelled.includes('cancelled'));
  results.push({test:'unknown verification off/on and independent cancellation',declined,verified,cancelled});
  const access=path.join(media,'access.wav');await copyFile(path.join(media,'48000-2.wav'),access);
  await page.locator('#file').setInputFiles(access);await page.locator('#open').click();
  await page.waitForFunction(()=>window.libzci.snapshot()?.sourceName==='access.wav'&&window.libzci.snapshot()?.output.highWater===8);
  await writeFile(access,Buffer.alloc(48000*4));await command('play');
  await wait(()=>window.libzci.snapshot()?.snapshot.state==='Failed');assert((await snap()).snapshot.error.includes('unavailable'));
  results.push({test:'Symphonia live File access loss stays typed',snapshot:(await snap()).snapshot});
  const reference=await browser.newPage();await reference.goto('http://localhost:5197/test/reference.html');await reference.waitForFunction(()=>!!window.referenceHarness);
  for(const name of ['44100-1.wav','44100-1.mp3','44100-1.flac','44100-1.ogg','48000-2.wav','48000-2.mp3','48000-2.flac','48000-2.ogg','tone.mod','tone.xm','tone.s3m','tone.it','tone.mo3','tone.ahx','tone.hvl']) {
    const rendered=path.join(media,name+'.native.f32');const run=spawnSync(cli,[path.join(media,name),'--render-pcm',rendered],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
    const bytes=await readFile(path.join(media,name));const pcm=await readFile(rendered);
    const expected=Array.from(new Float32Array(pcm.buffer,pcm.byteOffset,pcm.byteLength/4));
    const report=await reference.evaluate(async({name,bytes,expected,sourceRate})=>window.referenceHarness.run(new File([new Uint8Array(bytes)],name),new Float32Array(expected),0,3,48000,sourceRate),{name,bytes:Array.from(bytes),expected,sourceRate:name.startsWith('44100')?44100:48000});
    assert.equal(report.frames,pcm.length/8,`${name} native/browser frame equality`);assert(report.maxError<0.00003,`${name} max error ${report.maxError}`);assert(report.highWater<=8);
    results.push({name,test:'all samples versus native with delayed recycling',...report});console.log('passed samples:',name,report.frames,report.maxError);
  }
  await writeFile(path.join(root,'.local/libzci/m1-browser-evidence.json'),JSON.stringify(results,null,2));
}finally{await browser?.close();await server.close();}
