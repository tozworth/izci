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
  browser=await chromium.launch({headless:true});
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
  await writeFile(path.join(root,'.local/libzci/m1-webcodecs-evidence.json'),JSON.stringify(results,null,2));
}finally{await browser?.close();await server.close();}
