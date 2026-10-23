import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const server=await createServer({root:path.join(root,'libzci/consumers/crude-pwa'),server:{port:5197,strictPort:true}});await server.listen();
let browser;const results=[];
try {
  browser=await chromium.launch({headless:true,args:['--mute-audio']});
  const page=await browser.newPage();page.on('pageerror',e=>console.error(e));await page.goto('http://localhost:5197/test/reference.html');await page.waitForFunction(()=>!!window.referenceHarness);
  async function run(name,start=0,unavailable=false) {
    const dir=['mono','stereo'].includes(name)?'r3':'r4';
    const bytes=await readFile(path.join(root,`.local/libzci/media/${dir}/${name}.opus`));
    // This provider deliberately restarts/discards for exact seeks. Compare to
    // the sequential reference suffix; opusfile's optimized seek has its own
    // short decoder-preroll transient, so it is not a byte-identical golden.
    const full=await readFile(path.join(root,`.local/libzci/media/r4/${name}.f32`));
    const pcm=full.subarray(Math.round(start*48000)*8);
    const expected=Array.from(new Float32Array(pcm.buffer,pcm.byteOffset,pcm.byteLength/4));
    const report=await page.evaluate(async({name,bytes,expected,start,unavailable})=>{
      return window.referenceHarness.run(new File([new Uint8Array(bytes)],name+'.opus'),new Float32Array(expected),start,2,48000,48000,true,unavailable);
    },{name,bytes:Array.from(bytes),expected,start,unavailable});
    assert.equal(report.frames,pcm.length/8);assert(report.maxError<0.00003,`max error ${report.maxError}`);assert(report.highWater<=8);
    const provider=name==='chain'||unavailable?'org.xiph.opus':'browser.webcodecs.opus';assert.equal(report.provider,provider);
    results.push({name,start,unavailable,...report});console.log('passed:',name,start,report.provider,report.frames,report.maxError);
  }
  await run('mono');await run('stereo');await run('gain');await run('stereo',0.625);await run('stereo',1.250125);await run('chain');
  await run('mono',0,true);
  const player=await browser.newPage();await player.goto('http://localhost:5197');
  await player.locator('#prefer-webcodecs').check();await player.locator('#file').setInputFiles(path.join(root,'.local/libzci/media/r3/long.opus'));await player.locator('#open').click();
  await player.waitForFunction(()=>window.libzci.snapshot()?.snapshot.provider?.id==='browser.webcodecs.opus'&&!window.libzci.snapshot()?.snapshot.pending_operation);
  await player.locator('#play').click();await player.waitForFunction(()=>window.libzci.snapshot()?.snapshot.position_frames>1000);
  await player.evaluate(async()=>{await window.libzci.command('seek',20);await window.libzci.command('seek',0.1);await window.libzci.command('stop');});
  await player.waitForFunction(()=>window.libzci.snapshot()?.snapshot.position_frames===0&&window.libzci.snapshot()?.snapshot.requested==='Held'&&!window.libzci.snapshot()?.snapshot.pending_operation);
  await player.evaluate(()=>window.libzci.command('seek',30.000125));await player.waitForFunction(()=>!window.libzci.snapshot()?.snapshot.pending_operation&&window.libzci.snapshot()?.snapshot.position_frames===1440006);
  await player.locator('#play').click();await player.waitForFunction(()=>window.libzci.snapshot()?.snapshot.state==='Ended');
  const transport=await player.evaluate(()=>window.libzci.snapshot());assert.equal(transport.snapshot.error,null);assert.equal(transport.snapshot.position_frames,1440006);
  results.push({test:'optional provider real output / rapid seek / stop / EOF',...transport});
  await player.locator('#dispose').click();await player.waitForFunction(()=>window.libzci.snapshot()?.disposed);
  await writeFile(path.join(root,'.local/libzci/m1-webcodecs-evidence.json'),JSON.stringify(results,null,2));
}finally{await browser?.close();await server.close();}
