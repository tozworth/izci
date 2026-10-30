// Actual consumed AudioWorklet media, shared Session qualifier and OPFS SQL.
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const server=await createServer({root:path.join(root,'libzci/consumers/crude-pwa'),server:{port:5197,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true,args:['--mute-audio']});
const context=await browser.newContext(),page=await context.newPage(),errors=[],results=[];
page.on('pageerror',e=>errors.push(String(e)));
const wait=async predicate=>{try{await page.waitForFunction(predicate,undefined,{timeout:20000});}catch(e){console.error(await page.evaluate(()=>({o:window.libzci?.snapshot(),log:document.querySelector('#diagnostics')?.textContent})));throw e;}};
const count=async media=>(await page.evaluate(media=>window.libzci.catalogQuery({media}),media)).rows[0].facts.play_count;
try {
  await page.goto('http://localhost:5197/?profile=play-counts');await wait(()=>!!window.libzci?.snapshot()?.profile);
  const bytes=Array.from(await readFile(path.join(root,'.local/libzci/media/r3/long.opus')));
  const row=await page.evaluate(async bytes=>{
    const api=window.libzci,root=await navigator.storage.getDirectory(),handle=await root.getFileHandle('counts.opus',{create:true}),writer=await handle.createWritable();await writer.write(new Uint8Array(bytes));await writer.close();
    const added=await api.catalogAddFiles([await handle.getFile()],[handle],false);
    const row=(await api.catalogQuery({media:added.media[0]})).rows[0];
    const settings=api.snapshot().profile.settings;await api.queue({kind:'settings',settings:{...settings,volume:0.02,play_counts:{enabled:true,threshold_seconds:1}}});
    await api.queue({kind:'append',sources:[row.source]});await api.queue({kind:'next',ended:false});return row;
  },bytes);
  await wait(()=>window.libzci.snapshot()?.snapshot.position_frames>80000);
  assert.equal(await count(row.id),1);assert.equal((await page.evaluate(()=>window.libzci.snapshot())).snapshot.play_counts.pending,0);
  results.push({test:'real consumed output qualifies once and commits independently of document timers'});
  await page.evaluate(()=>window.libzci.command('pause'));await page.waitForTimeout(1250);assert.equal(await count(row.id),1);
  await page.evaluate(()=>window.libzci.command('play'));await page.waitForTimeout(450);await page.evaluate(()=>window.libzci.command('pause'));
  assert.equal(await count(row.id),1,'short resumed segment does not inherit earlier credit');
  await page.evaluate(()=>window.libzci.command('seek',0));await wait(()=>!window.libzci.snapshot()?.snapshot.pending_operation);
  await page.evaluate(()=>window.libzci.command('play'));
  const cdp=await context.newCDPSession(page);await cdp.send('Debugger.enable');await cdp.send('Debugger.pause');
  // Only the document is paused; the control worker must commit the count.
  await new Promise(resolve=>setTimeout(resolve,1800));await cdp.send('Debugger.resume');await cdp.detach();
  await wait(()=>window.libzci.snapshot()?.snapshot.position_frames>80000);assert.equal(await count(row.id),2);
  await page.evaluate(()=>window.libzci.command('pause'));
  results.push({test:'pause resets continuous credit; seek and resumed audio qualify while the document debugger is paused'});
  await page.evaluate(async()=>{const api=window.libzci,p=api.snapshot().profile;await api.queue({kind:'settings',settings:{...p.settings,play_counts:{enabled:false,threshold_seconds:1}}});await api.command('seek',0);});
  await wait(()=>!window.libzci.snapshot()?.snapshot.pending_operation);await page.evaluate(()=>window.libzci.command('play'));await page.waitForTimeout(1500);assert.equal(await count(row.id),2);await page.evaluate(()=>window.libzci.command('pause'));
  await page.reload();await wait(()=>!!window.libzci?.snapshot()?.profile);
  assert.equal(await count(row.id),2);assert.equal((await page.evaluate(()=>window.libzci.snapshot())).profile.settings.play_counts.enabled,false);
  assert.equal((await page.evaluate(()=>window.libzci.snapshot())).snapshot.play_counts.credited_seconds,0);
  const facts=(await page.evaluate(media=>window.libzci.catalogQuery({media}),row.id)).rows[0].facts;assert(facts.last_played_ms>0);
  results.push({test:'disabled counting persists; counts and last-played reopen from SQL, continuity remains transient'});
  // A queue-only File has no Library identity even when its basename matches.
  await page.evaluate(async bytes=>{const api=window.libzci,p=api.snapshot().profile;await api.queue({kind:'settings',settings:{...p.settings,play_counts:{enabled:true,threshold_seconds:1}}});await api.load(new File([new Uint8Array(bytes)],'counts.opus'));},bytes);
  await wait(()=>window.libzci.snapshot()?.snapshot.state==='Ready');await page.evaluate(()=>window.libzci.command('play'));await wait(()=>window.libzci.snapshot()?.snapshot.position_frames>80000);await page.evaluate(()=>window.libzci.command('pause'));
  assert.equal(await count(row.id),2);assert.equal((await page.evaluate(()=>window.libzci.snapshot())).snapshot.play_counts.credited_seconds,0);
  results.push({test:'same-name queue-only Files cannot update Library counts'});
  assert.deepEqual(errors,[]);
}finally {
  await writeFile(path.join(root,'.local/libzci/m3-play-counts-evidence.json'),JSON.stringify({results,errors},null,2));
  await browser.close();await server.close();
}
console.log(results);
