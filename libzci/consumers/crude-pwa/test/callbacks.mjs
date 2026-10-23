import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const server=await createServer({root:path.join(root,'libzci/consumers/crude-pwa'),server:{port:5197,strictPort:true}});
await server.listen();
const results=[];
let browser;
try {
  browser=await chromium.launch({headless:true,args:['--mute-audio']});
  const page=await browser.newPage();page.on('pageerror',e=>console.error(e));
  await page.goto('http://localhost:5197/test/reference.html');
  await page.waitForFunction(()=>!!window.referenceHarness);
  async function input(name) {
    const dir=['mono','stereo','long'].includes(name)?'r3':'r4';
    return Array.from(await readFile(path.join(root,`.local/libzci/media/${dir}/${name}.opus`)));
  }
  async function run(name,start=0,delay=0,rate=48000) {
    const reference=await readFile(path.join(root,`.local/libzci/media/r4/${name}${start?'-'+Math.round(start*48000):''}.f32`));
    const expected=Array.from(new Float32Array(reference.buffer,reference.byteOffset,reference.byteLength/4));
    const report=await page.evaluate(async ({bytes,expected,start,delay,rate})=>window.referenceHarness.run(new File([new Uint8Array(bytes)],'input.opus'),new Float32Array(expected),start,delay,rate),{bytes:await input(name),expected,start,delay,rate});
    const total=reference.length/8;
    assert.equal(report.frames,Math.ceil(total*rate/48000));
    assert(report.maxError<0.00003,`native/browser max sample error ${report.maxError}`);
    assert(report.highWater<=8);assert(report.stats.maxRead<=32768);assert.equal(report.stats.codecHeapBytes,33554432);
    results.push({name,start,delay,rate,...report});
    console.log('passed:',name,start,rate,report.frames,'frames; max sample error',report.maxError);
  }
  await run('mono');await run('stereo');await run('gain');await run('chain');
  await run('chain',0.3);await run('stereo',0.625);await run('stereo',1.250125);
  await run('long',0,30);await run('stereo',0,0,44100);
  // Separate worker instances remain independent, including callbacks and close.
  await Promise.all([run('stereo',0.2),run('mono',0.05)]);
  await page.locator('#scan').setInputFiles(path.join(root,'.local/libzci/media/r4/scan.opus'));
  const cancelled=await page.evaluate(async replacement=>window.referenceHarness.cancellations(document.querySelector('#scan').files[0],new File([new Uint8Array(replacement)],'mono.opus')),await input('mono'));
  assert(cancelled.latency<2000);assert.equal(cancelled.position,2400);
  results.push({name:'cancel real 1000-link scan, replace, seek, close',...cancelled});
  for(const name of ['corrupt','truncated','mapping']) {
    const error=await page.evaluate(async bytes=>{try {await window.referenceHarness.run(new File([new Uint8Array(bytes)],'bad.opus'),new Float32Array());return null;}catch(e){return String(e);}},await input(name));
    assert(error && /unsupported|corrupt|decoder-failure/.test(error),`${name} must report a typed media failure`);results.push({name,error});
  }
  await writeFile(path.join(root,'.local/libzci/r4-callback-evidence.json'),JSON.stringify(results,null,2));
} finally {await browser?.close();await server.close();}
