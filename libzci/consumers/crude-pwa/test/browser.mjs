// Real Chromium File + C callbacks + AudioContext/worklet integration.
// A fresh browser profile and dedicated origin never touch izci grants/state.
import { chromium } from 'playwright';
import { preview } from 'vite';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const consumer=path.join(root,'libzci/consumers/crude-pwa');
const server=await preview({root:consumer,preview:{port:5197,strictPort:true}});
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const results=[];
try {
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>{errors.push(String(e));console.error(e);});
  page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  await page.addInitScript(()=>{Object.defineProperty(globalThis,'AudioDecoder',{value:undefined,configurable:true});});
  await page.goto('http://localhost:5197');
  const snap=()=>page.evaluate(()=>window.libzci.snapshot());
  const command=(kind,value=0)=>page.evaluate(([k,v])=>window.libzci.command(k,v),[kind,value]);
  const wait=async predicate=>page.waitForFunction(predicate,undefined,{timeout:15000});
  await page.locator('#file').setInputFiles(path.join(root,'.local/libzci/media/r3/stereo.opus'));
  await page.locator('#open').click();
  await wait(()=>window.libzci.snapshot()?.snapshot.state==='Ready');
  console.log('opened',JSON.stringify(await snap()));
  await page.locator('#play').click();
  await wait(()=>window.libzci.snapshot()?.snapshot.position_frames>10000);
  const playing=await snap();
  assert(playing.output.energy>0,'real worklet output is audible/nonzero');
  assert(playing.snapshot.provider.version.includes('libopusfile-0.12'));
  await command('pause');
  await wait(()=>window.libzci.snapshot()?.snapshot.requested==='Held');
  const paused=(await snap()).snapshot.position_frames;
  await page.waitForTimeout(200);
  assert.equal((await snap()).snapshot.position_frames,paused);
  await command('seek',0.3);
  await wait(()=>!window.libzci.snapshot()?.snapshot.pending_operation && window.libzci.snapshot()?.snapshot.position_frames===14400);
  await command('play');
  await wait(()=>window.libzci.snapshot()?.snapshot.state==='Ended');
  const ended=await snap();assert.equal(ended.snapshot.position_frames,ended.snapshot.total_frames);
  results.push({test:'File reference output / pause / seek / final drain',result:'passed',playing,ended});
  assert.equal(errors.length,0);
  console.log(JSON.stringify(results,null,2));
  await mkdir(path.join(root,'.local/libzci'),{recursive:true});
  await writeFile(path.join(root,'.local/libzci/r4-browser-evidence.json'),JSON.stringify(results,null,2));
} finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
