// Production assets, real browser OPFS SQLite and real OPFS capability handles.
// OPFS handles exercise structured clone/recovery; external picker grants remain
// a separate physical/interactive check, never replaced with synthetic handles.
import {chromium} from 'playwright';
import {preview} from 'vite';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const server=await preview({root:path.join(root,'libzci/consumers/crude-pwa'),preview:{port:5197,strictPort:true}});
const browser=await chromium.launch({headless:true,args:['--mute-audio']});
const context=await browser.newContext();const results=[];const errors=[];
const open=async()=>{const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')console.error(m.text());});await page.goto('http://localhost:5197/?profile=m2-test');return page;};
const wait=async(page,predicate)=>{try{await page.waitForFunction(predicate,undefined,{timeout:30000});}catch(e){console.error(await page.evaluate(()=>({s:window.libzci?.snapshot(),log:document.querySelector('#diagnostics')?.textContent})));throw e;}};
try {
  let owner=await open();await wait(owner,()=>window.libzci?.snapshot()?.profile);
  await owner.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await wait(owner,()=>!!navigator.serviceWorker.controller);
  const bytes=Array.from(await readFile(path.join(root,'.local/libzci/media/r3/long.opus')));
  await owner.evaluate(async bytes=>{
    const root=await navigator.storage.getDirectory();const handle=await root.getFileHandle('m2-tone.opus',{create:true});
    const writer=await handle.createWritable();await writer.write(new Uint8Array(bytes));await writer.close();
    // A genuine browser capability, not an object shaped like a handle.
    await window.libzci.ingest([await handle.getFile(),await handle.getFile()],[handle,handle]);
  },bytes);
  await wait(owner,()=>window.libzci.snapshot()?.snapshot.state==='Ready');
  await owner.evaluate(async()=>{
    const p=window.libzci.snapshot().profile;
    await window.libzci.queue({kind:'settings',settings:{...p.settings,volume:0.37,repeat:'all'}});
    await window.libzci.queue({kind:'move',id:2,index:0});await window.libzci.queue({kind:'up_next',id:2});
    await window.libzci.command('play');
  });
  await wait(owner,()=>window.libzci.snapshot()?.output.energy>0&&window.libzci.snapshot()?.snapshot.position_frames>1000);
  await owner.evaluate(()=>window.libzci.command('pause'));
  const state=await owner.evaluate(()=>window.libzci.snapshot().profile);
  assert.deepEqual(state.queue.items.map(i=>i.id),[2,1]);assert.equal(state.settings.volume,0.37);
  results.push({test:'real OPFS SQLite commit, duplicate queue, move, settings and real worklet output',revision:state.revision});
  await owner.evaluate(()=>window.libzci.queue({kind:'clear_up_next'}));
  const retry={type:'request',from:'m2-retry-client',id:'retry-1',action:'queue',args:[{kind:'up_next',id:2}]};
  const deliver=async page=>page.evaluate(message=>new Promise(resolve=>{const channel=new BroadcastChannel('libzci-crude-v1-m2-test');channel.onmessage=e=>{if(e.data.type==='result'&&e.data.id===message.id){channel.close();resolve(e.data);}};channel.postMessage(message);channel.postMessage(message);}),retry);
  assert(!(await deliver(owner)).error);await wait(owner,()=>window.libzci.snapshot()?.profile?.queue.up_next.length===1);
  const attached=await open();await wait(attached,()=>window.libzci.snapshot()?.ownership==='attached'&&window.libzci.snapshot()?.profile?.queue.items.length===2);
  assert.equal(attached.workers().length,0,'attached document creates no engine/decoder/SQL worker');
  await attached.evaluate(()=>window.libzci.command('volume',0.29));
  await wait(owner,()=>Math.abs(window.libzci.snapshot()?.profile?.settings.volume-0.29)<0.0001);
  const locks=await owner.evaluate(()=>navigator.locks.query());assert.equal(locks.held.filter(l=>l.name==='libzci-crude-profile-v1-m2-test').length,1);
  results.push({test:'attached commands commit through exactly one owner',held:locks.held});
  await owner.close();owner=attached;
  await wait(owner,()=>window.libzci.snapshot()?.ownership==='owner'&&window.libzci.snapshot()?.profile?.queue.items.length===2);
  assert.equal((await owner.evaluate(()=>window.libzci.snapshot())).snapshot.requested,'Held');
  results.push({test:'owner loss and election reopen durable state paused'});
  assert(!(await deliver(owner)).error);await wait(owner,()=>window.libzci.snapshot()?.profile?.queue.up_next.length===1);
  results.push({test:'duplicated requests remain idempotent after owner loss and SQL reopen'});
  await owner.evaluate(async()=>{
    const request=indexedDB.open('libzci-crude-capabilities-v1-m2-test',1);const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('handles','readwrite'),store=tx.objectStore('handles'),all=store.getAll();all.onsuccess=()=>{store.put({...all.result[0],pending:true});store.put({...all.result[0],key:'crash-orphan',pending:true});};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  });
  await owner.reload();await wait(owner,()=>window.libzci.snapshot()?.profile?.queue.items.length===2&&window.libzci.snapshot()?.access==='granted');
  const registry=await owner.evaluate(async()=>{const request=indexedDB.open('libzci-crude-capabilities-v1-m2-test',1);const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));const rows=await new Promise(resolve=>{const r=db.transaction('handles').objectStore('handles').getAll();r.onsuccess=()=>resolve(r.result.map(({key,pending})=>({key,pending})));});db.close();return rows;});
  assert.equal(registry.length,2);assert(registry.every(r=>!r.pending));results.push({test:'pending SQL-referenced capabilities complete; unreferenced crash orphans are removed'});
  await owner.evaluate(()=>window.libzci.command('play'));
  await wait(owner,()=>window.libzci.snapshot()?.output.energy>0&&window.libzci.snapshot()?.snapshot.position_frames>1000);
  await owner.evaluate(()=>window.libzci.command('pause'));
  results.push({test:'SQL queue/settings + IDB capabilities survive cold worker reopen'});
  await owner.evaluate(async()=>{const s=window.libzci.snapshot();await window.libzci.queue({kind:'settings',settings:{...s.profile.settings,repeat:'off'}});await window.libzci.command('seek',s.snapshot.total_frames/s.snapshot.sample_rate-0.05);await window.libzci.command('play');});
  await wait(owner,()=>window.libzci.snapshot()?.profile?.queue.current===2&&window.libzci.snapshot()?.snapshot.position_frames>1000&&window.libzci.snapshot()?.output.energy>0);
  await owner.evaluate(()=>window.libzci.command('pause'));results.push({test:'final consumption advances to core-selected up-next duplicate'});
  const inventory=await owner.evaluate(async()=>{const identity=await (await fetch('/asset-identity.json')).json();const cache=await caches.open((await caches.keys()).find(k=>k.startsWith('libzci-crude-v1-')));return {identity,missing:(await Promise.all(identity.assets.map(async a=>({url:a.url,bytes:(await (await cache.match(a.url))?.arrayBuffer())?.byteLength,expected:a.bytes})))).filter(a=>a.bytes!==a.expected)};});
  assert.deepEqual(inventory.missing,[]);assert(inventory.identity.assets.filter(a=>a.url.endsWith('.wasm')).length>=5);
  // Tear down all documents before relaunch so no live decoder or page cache can
  // stand in for a cold offline bootstrap.
  await owner.close();await context.setOffline(true);owner=await open();
  await wait(owner,()=>window.libzci.snapshot()?.profile?.queue.items.length===2&&window.libzci.snapshot()?.access==='granted');
  await owner.evaluate(()=>window.libzci.command('play'));await wait(owner,()=>window.libzci.snapshot()?.output.energy>0);
  results.push({test:'cold offline document, SQL worker, codecs, WASM and real local output',assets:inventory.identity.assets.length,version:inventory.identity.version});
  await owner.close();await context.setOffline(false);owner=await context.newPage();await owner.goto('http://localhost:5197/?profile=m2-plain');
  await wait(owner,()=>window.libzci?.snapshot()?.profile);
  await owner.evaluate(bytes=>window.libzci.load(new File([new Uint8Array(bytes)],'plain.opus')),bytes);
  await wait(owner,()=>window.libzci.snapshot()?.snapshot.state==='Ready');
  await owner.reload();await wait(owner,()=>window.libzci.snapshot()?.access?.startsWith('non-restorable'));
  assert.equal((await owner.evaluate(()=>window.libzci.snapshot().profile)).queue.items.length,1);
  results.push({test:'plain File rows survive reload with explicit non-restorable status'});
  assert.deepEqual(errors,[]);
} finally {
  await mkdir(path.join(root,'.local/libzci'),{recursive:true});await writeFile(path.join(root,'.local/libzci/m2-browser-evidence.json'),JSON.stringify({results,errors},null,2));
  await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));
}
console.log(JSON.stringify(results,null,2));
