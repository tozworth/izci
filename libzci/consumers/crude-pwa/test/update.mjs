import {chromium} from 'playwright';
import {preview} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),dist=path.join(root,'libzci/consumers/crude-pwa/dist');
const sw=await readFile(path.join(dist,'sw.js'),'utf8'),html=await readFile(path.join(dist,'index.html'),'utf8'),identity=JSON.parse(await readFile(path.join(dist,'asset-identity.json'),'utf8'));
let phase='original';const next='abcdef0123456789abcdef01',broken='badbad0123456789abcdef01';
const server=await preview({root:path.dirname(dist),preview:{port:5197,strictPort:true},plugins:[{name:'test-coherent-update',configurePreviewServer(server){server.middlewares.use((req,res,done)=>{
  const url=req.url.split('?')[0];
  if(url==='/m2-missing-asset'){res.statusCode=503;res.end('unavailable');return;}
  if(url==='/sw.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');let source=sw;
    if(phase!=='original')source=source.replaceAll(identity.version,phase==='broken'?broken:next);
    if(phase==='broken')source=source.replace('URLS=[','URLS=["/m2-missing-asset",');res.end(source);return;}
  if(phase==='next'&&(url==='/'||url==='/index.html')){res.setHeader('Content-Type','text/html');res.end(html.replaceAll(identity.version,next));return;}
  if(phase==='next'&&url==='/asset-identity.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...identity,version:next}));return;}
  done();
});}}]});
const browser=await chromium.launch({headless:true,args:['--mute-audio']});const context=await browser.newContext();const results=[];
try {
  const owner=await context.newPage();
  await owner.goto('http://localhost:5197/?profile=update-test');await owner.waitForFunction(()=>window.libzci?.snapshot()?.profile);await owner.evaluate(()=>navigator.serviceWorker.ready);await owner.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const bytes=Array.from(await readFile(path.join(root,'.local/libzci/media/r3/long.opus')));
  await owner.evaluate(async bytes=>{const root=await navigator.storage.getDirectory();const h=await root.getFileHandle('update.opus',{create:true});const writer=await h.createWritable();await writer.write(new Uint8Array(bytes));await writer.close();await window.libzci.ingest([await h.getFile()],[h]);await window.libzci.command('play');},bytes);
  await owner.waitForFunction(()=>window.libzci.snapshot()?.snapshot.position_frames>1000);
  const old=await context.newPage();await old.goto('http://localhost:5197/?profile=update-test');await old.waitForFunction(()=>window.libzci?.snapshot()?.ownership==='attached');
  phase='broken';await owner.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();await new Promise(resolve=>{const worker=r.installing;if(!worker||worker.state==='redundant')return resolve();worker.addEventListener('statechange',()=>{if(worker.state==='redundant')resolve();});});});
  assert(!(await owner.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting)));
  assert(await owner.evaluate(version=>caches.has(`libzci-crude-v1-${version}`),identity.version));
  const before=await owner.evaluate(()=>window.libzci.snapshot().snapshot.position_frames);
  phase='next';await owner.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});
  await owner.waitForFunction(async expected=>{const worker=(await navigator.serviceWorker.getRegistration()).waiting;if(!worker)return false;return new Promise(resolve=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve(false);},1000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data.version===expected);};worker.postMessage({type:'identify'},[channel.port2]);});},next);
  assert(await owner.evaluate(next=>caches.has(`libzci-crude-v1-${next}`),next),'waiting worker retains its complete candidate cache');
  await owner.waitForFunction(before=>window.libzci.snapshot()?.snapshot.position_frames>before+4800,before);
  results.push({test:'failed precache leaves old runtime/cache usable; complete update waits during playback'});
  await owner.locator('#update').click();await owner.waitForFunction(next=>document.querySelector('meta[name="libzci-version"]')?.content===next,next);
  await owner.waitForFunction(()=>window.libzci?.snapshot()?.profile?.queue.items.length===1);
  assert.equal((await owner.evaluate(()=>window.libzci.snapshot())).snapshot.requested,'Held');
  assert(await owner.evaluate(version=>caches.has(`libzci-crude-v1-${version}`),identity.version),'old document retains its coherent cache');
  await old.close();await owner.evaluate(()=>navigator.serviceWorker.controller.postMessage({type:'client-version',version:document.querySelector('meta[name="libzci-version"]').content}));
  await owner.waitForFunction(async version=>!(await caches.has(`libzci-crude-v1-${version}`)),identity.version);
  results.push({test:'explicit update restores queue/grants paused and retains old assets only while old documents exist'});
}catch(error){console.error(await context.pages()[0].evaluate(async()=>({version:document.querySelector('meta[name="libzci-version"]')?.content,pwa:document.querySelector('#pwa-status')?.textContent,caches:await Promise.all((await caches.keys()).map(async key=>({key,html:(await (await (await caches.open(key)).match('/index.html'))?.text())?.match(/libzci-version[^>]+/g)}))),registration:{active:(await navigator.serviceWorker.getRegistration())?.active?.state,waiting:(await navigator.serviceWorker.getRegistration())?.waiting?.state}})));throw error;}
finally{await writeFile(path.join(root,'.local/libzci/m2-update-evidence.json'),JSON.stringify({results},null,2));await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
console.log(results);
