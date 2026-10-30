import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),out=path.join(root,'.local/libzci/media/m3/images');await mkdir(out,{recursive:true});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
const be=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const chunk=(name,bytes)=>{const body=Buffer.concat([Buffer.from(name),bytes]);return Buffer.concat([be(bytes.length),body,be(crc32(body))]);};
function png(width,height,pixels,orientation=1,icc=null){
  const header=Buffer.concat([be(width),be(height),Buffer.from([8,6,0,0,0])]),exif=Buffer.from([73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0]);
  const rows=[];for(let y=0;y<height;y++)rows.push(Buffer.from([0]),pixels.subarray(y*width*4,(y+1)*width*4));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('eXIf',exif),...(icc?[chunk('iCCP',Buffer.concat([Buffer.from('sRGB\0\0'),deflateSync(icc)]))]:[]),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
const pixels=Buffer.from([1,2,3,4,5,6].flatMap(n=>[n*30,0,0,255])),expected=[[1,2,3,4,5,6],[2,1,4,3,6,5],[6,5,4,3,2,1],[5,6,3,4,1,2],[1,3,5,2,4,6],[5,3,1,6,4,2],[6,4,2,5,3,1],[2,4,6,1,3,5]];
const server=await createServer({root:path.join(root,'libzci/consumers/crude-pwa'),server:{port:5197,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true,args:['--mute-audio']}),context=await browser.newContext(),page=await context.newPage(),errors=[],results=[];
page.on('pageerror',e=>errors.push(String(e)));await context.addInitScript(()=>{window.outputs=0;const A=window.AudioContext;window.AudioContext=class extends A{constructor(...args){super(...args);window.outputs++;}};});
await context.addInitScript(()=>{window.imageUrls=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);window.imageUrls.add(url);return url;};URL.revokeObjectURL=url=>{window.imageUrls.delete(url);revoke(url);};});
async function job(bytes,request){return page.evaluate(async({bytes,request})=>{
  const {ImageJob}=await import('/src/image-job.ts');const job=new ImageJob(new File([new Uint8Array(bytes)],'test.png'),request),result=await job.result;
  if(!result.rendition)return {facts:result.facts,rendition:null};
  const bitmap=await createImageBitmap(new Blob([result.png],{type:'image/png'})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
  const pixels=Array.from(ctx.getImageData(0,0,canvas.width,canvas.height).data);
  return {facts:result.facts,rendition:result.rendition,pixels,pngBytes:Array.from(result.png)};
},{bytes:Array.from(bytes),request});}
try{
  await page.goto('http://localhost:5197/?profile=images');await page.waitForFunction(()=>!!window.libzci?.snapshot()?.profile);
  for(let orientation=1;orientation<=8;orientation++){
    const bytes=png(2,3,pixels,orientation),result=await job(bytes,{kind:'image',spec:{max_edge:8}});
    assert.equal(result.facts.orientation,orientation);assert.deepEqual([result.rendition.width,result.rendition.height],orientation<=4?[2,3]:[3,2]);assert.deepEqual(result.pixels.filter((_,i)=>i%4===0).map(v=>v/30),expected[orientation-1]);
    const info=await job(Buffer.from(result.pngBytes),{kind:'inspect'});assert.equal(info.facts.orientation,1);assert.equal(info.rendition,null);
  }
  const alpha=await job(png(2,1,Buffer.from([255,0,0,255,0,0,255,0])),{kind:'image',spec:{max_edge:1}});assert(alpha.pixels[0]>250&&alpha.pixels[2]===0&&alpha.pixels[3]>100&&alpha.pixels[3]<160);
  results.push({test:'all eight exact EXIF orientations and tag removal, bounded headers, alpha-correct resize through shared WASM'});
  let icc=null;try{icc=await readFile(process.env.LIBZCI_TEST_ICC??path.join(process.env.WINDIR??'C:/Windows','System32/spool/drivers/color/sRGB Color Space Profile.icm'));}catch{}
  if(icc){
    const result=await job(png(1,1,Buffer.from([128,50,180,117]),1,icc),{kind:'image',spec:{max_edge:1}});assert.equal(result.facts.icc_bytes,icc.length);assert.equal(result.facts.icc_sha256,createHash('sha256').update(icc).digest('hex'));
    // Canvas alpha round-tripping can add two units of quantization.
    for(const [i,n]of [128,50,180,117].entries())assert(Math.abs(result.pixels[i]-n)<=3);
    results.push({test:'shared ICC-to-sRGB worker path preserves color/alpha; raw ICC stays outside result facts',iccSha256:result.facts.icc_sha256});
  }else results.push({test:'browser ICC runtime check',status:'not-run',reason:'set LIBZCI_TEST_ICC to an sRGB ICC profile'});
  assert.equal(await page.evaluate(()=>window.outputs),0);assert.equal((await page.evaluate(()=>window.libzci.snapshot())).snapshot.state,'Idle');
  const imported=await page.evaluate(async bytes=>{
    const api=window.libzci,file=new File([new Uint8Array(bytes)],'renamed.wav');
    const result=await api.catalogAddFiles([file],[],false);const row=(await api.catalogQuery({media:result.media[0]})).rows[0];
    const before=api.snapshot().profile;let queueRejected=false;try{await api.queue({kind:'append',sources:[row.source]});}catch{queueRejected=true;}
    const rendition=await api.catalogRendition(row.id,2);
    let fileRejected=false;try{await api.load(file);}catch{fileRejected=true;}
    return {row,queueRejected,fileRejected,before,after:api.snapshot().profile,rendition:rendition.rendition};
  },Array.from(png(2,3,pixels,6)));
  assert.equal(imported.row.kind,'image');assert.equal(imported.row.metadata.image.orientation,6);assert.equal(imported.row.metadata.duration_seconds,null);assert(imported.queueRejected&&imported.fileRejected);assert.deepEqual(imported.before,imported.after);assert.deepEqual([imported.rendition.width,imported.rendition.height],[2,1]);
  results.push({test:'content-identified catalog image facts and renditions persist; both queue APIs reject images atomically'});
  const managed=await page.evaluate(async bytes=>{
    const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('pictures',{create:true});
    for(const name of ['a.png','b.jpg']){const handle=await directory.getFileHandle(name,{create:true}),writer=await handle.createWritable();await writer.write(new Uint8Array(bytes));await writer.close();}
    const root=(await window.libzci.catalogAddRoot(directory,{recursive:true,scan_on_launch:false,verify_unknown:false,probe_concurrency:2})).root;await window.libzci.catalogScan(root);return root;
  },Array.from(png(2,3,pixels,6)));
  await page.waitForFunction(()=>window.libzci.snapshot()?.scan?.state!=='scanning');
  const scanned=await page.evaluate(root=>window.libzci.catalogQuery({root,kind:'image'}),managed);assert.equal(scanned.total,2);assert.equal(scanned.rows[0].metadata.image.orientation,6);
  const imageId=scanned.rows[0].id;
  await page.evaluate(async media=>{await window.libzci.catalogMutate({kind:'favorite',media,subsong:null,favorite:true});const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('pictures'),handle=await directory.getFileHandle('bad.png',{create:true}),writer=await handle.createWritable();await writer.write('corrupt image');await writer.close();},imageId);
  await page.evaluate(root=>window.libzci.catalogScan(root),managed);await page.waitForFunction(()=>window.libzci.snapshot()?.scan?.state!=='scanning');assert.equal((await page.evaluate(()=>window.libzci.snapshot())).scan.state,'failed');
  assert.equal((await page.evaluate(root=>window.libzci.catalogQuery({root,kind:'image'}),managed)).total,2);
  await page.evaluate(async root=>{const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('pictures');await directory.removeEntry('bad.png');await window.libzci.catalogScan(root);},managed);await page.waitForFunction(()=>window.libzci.snapshot()?.scan?.state!=='scanning');
  assert.equal((await page.evaluate(media=>window.libzci.catalogRendition(media,2),imageId)).cache,'miss');
  assert.equal((await page.evaluate(media=>window.libzci.catalogRendition(media,2),imageId)).cache,'hit');
  await page.reload();await page.waitForFunction(()=>!!window.libzci?.snapshot()?.profile);
  const reopened=await page.evaluate(media=>window.libzci.catalogQuery({media}),imageId);assert.equal(reopened.rows[0].facts.favorite,true);assert.equal(reopened.rows[0].metadata.image.orientation,6);
  const restored=await page.evaluate(media=>window.libzci.catalogRendition(media,2),imageId);assert.deepEqual([restored.rendition.width,restored.rendition.height],[2,1]);assert.equal(restored.cache,'hit');assert.equal(restored.facts.orientation,6);assert.equal(await page.evaluate(()=>window.outputs),0);
  const cacheCases=await page.evaluate(async({media,replacement,original,restoredSize})=>{
    const api=window.libzci,before=api.snapshot().profile,row=(await api.catalogQuery({media})).rows[0];
    const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('pictures'),handle=await directory.getFileHandle('a.png'),file=await handle.getFile();
    const {initializeControl}=await import('/src/control-wasm.ts');await initializeControl();
    const {image_cache_key}=await import('/src/generated/libzci_web.js');const key=image_cache_key(row.source.key,`${file.size}:${file.lastModified}`,JSON.stringify({kind:'image',spec:{max_edge:2}}));
    const open=indexedDB.open('libzci-artwork-cache-v1-images');const db=await new Promise((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('png','readwrite');tx.objectStore('png').put(new Blob([new Uint8Array(restoredSize)]),key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    const repaired=await api.catalogRendition(media,2),repairedHit=await api.catalogRendition(media,2);
    const writer=await handle.createWritable();await writer.write(new Uint8Array(replacement));await writer.close();const changed=await api.catalogRendition(media,2);
    const restore=await handle.createWritable();await restore.write(new Uint8Array(original));await restore.close();
    db.close();return {repaired:repaired.cache,repairedHit:repairedHit.cache,changed:{cache:changed.cache,width:changed.facts.width,height:changed.facts.height},before,after:api.snapshot().profile};
  },{media:imageId,replacement:Array.from(png(1,1,Buffer.from([0,255,0,255]))),original:Array.from(png(2,3,pixels,6)),restoredSize:restored.png.length});
  assert.equal(cacheCases.repaired,'miss');assert.equal(cacheCases.repairedHit,'hit');assert.deepEqual(cacheCases.changed,{cache:'miss',width:1,height:1});assert.deepEqual(cacheCases.before,cacheCases.after);
  results.push({test:'separate cache reopens, verifies original orientation once, rebuilds corruption, invalidates source revisions without domain writes'});
  const failures=await page.evaluate(bytes=>new Promise((resolve,reject)=>{const worker=new Worker('/test/rendition-cache-worker.ts',{type:'module'});worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};worker.onmessage=e=>{worker.terminate();if(e.data.error)reject(new Error(e.data.error));else resolve(e.data);};worker.postMessage(bytes);}),Array.from(png(2,3,pixels,6)));
  assert(failures.denied&&failures.cached&&failures.preserved);assert.equal(failures.quota,'unavailable');results.push({test:'actual catalog worker path checks denied grants before cache lookup and survives injected IDB quota/transaction abort without changing domain state'});
  const lru=await page.evaluate(async bytes=>{
    const {RenditionCache}=await import('/src/rendition-cache.ts'),{ImageJob}=await import('/src/image-job.ts');
    const r=await new ImageJob(new File([new Uint8Array(bytes)],'image.png'),{kind:'image',spec:{max_edge:2}}).result;
    const cache=new RenditionCache('images-lru',{bytes:r.png.length*2,entries:2}),key=n=>n.toString(16).padStart(64,'0');
    await cache.put(key(1),r.metadata,r.png);await cache.put(key(2),r.metadata,r.png);await cache.get(key(1));await cache.put(key(3),r.metadata,r.png);
    const evicted=await cache.get(key(2))===null,kept=!!await cache.get(key(1));
    await Promise.all([4,5,6,7].map(n=>cache.put(key(n),r.metadata,r.png)));
    const open=indexedDB.open('libzci-artwork-cache-v1-images-lru'),db=await new Promise(resolve=>{open.onsuccess=()=>resolve(open.result);});
    const state=await new Promise(resolve=>{const tx=db.transaction(['metadata','png'],'readonly'),meta=tx.objectStore('metadata').getAll(),png=tx.objectStore('png').count();tx.oncomplete=()=>resolve({entries:meta.result.length,bytes:meta.result.reduce((n,e)=>n+e.bytes,0),payloads:png.result});});db.close();
    await cache.clear();const cleared=await cache.get(key(7))===null;return {evicted,kept,cleared,state,limit:r.png.length*2};
  },Array.from(png(2,3,pixels,6)));
  assert(lru.evicted&&lru.kept&&lru.cleared);assert.equal(lru.state.entries,2);assert.equal(lru.state.payloads,2);assert(lru.state.bytes<=lru.limit);
  results.push({test:'shared LRU policy bounds concurrent real IndexedDB admissions by bytes and entries; clear removes metadata and PNGs'});
  results.push({test:'real OPFS folder image scans, failed-scan preservation, favorites and capability-backed rendition reopen without output'});
  const corrupt=Buffer.from(png(1,1,Buffer.from([0,0,0,255])));corrupt.writeUInt32BE(32768,16);corrupt.writeUInt32BE(32768,20);corrupt.writeUInt32BE(crc32(corrupt.subarray(12,29)),29);
  const denied=await page.evaluate(async bytes=>{const {ImageJob}=await import('/src/image-job.ts');try{await new ImageJob(new File([new Uint8Array(bytes)],'bomb.png'),{kind:'image',spec:{max_edge:64}}).result;return false;}catch(e){return e.kind==='resource-exhausted';}},Array.from(corrupt));assert(denied);
  const cancelled=await page.evaluate(async bytes=>{const {ImageJob}=await import('/src/image-job.ts');const job=new ImageJob(new File([new Uint8Array(bytes)],'test.png'),{kind:'image',spec:{max_edge:64}});job.cancel();try{await job.result;return false;}catch(e){return e.kind==='cancelled';}},Array.from(png(2,3,pixels)));assert(cancelled);
  await page.evaluate(async bytes=>window.libzci.load(new File([new Uint8Array(bytes)],'long.opus')),Array.from(await readFile(path.join(root,'.local/libzci/media/r3/long.opus'))));
  await page.waitForFunction(()=>window.libzci.snapshot()?.snapshot.state==='Ready');await page.evaluate(()=>window.libzci.command('volume',0.02));await page.evaluate(()=>window.libzci.command('play'));await page.waitForFunction(()=>window.libzci.snapshot()?.snapshot.position_frames>10000);
  const before=(await page.evaluate(()=>window.libzci.snapshot())).snapshot;
  const artwork=await job(await readFile(path.join(root,'.local/libzci/media/m3/artwork.opus')),{kind:'artwork',spec:{max_edge:64}});assert.deepEqual([artwork.rendition.width,artwork.rendition.height],[64,64]);assert.equal(artwork.facts.width,256);
  for(let n=0;n<3;n++)await job(png(2,3,pixels,6),{kind:'image',spec:{max_edge:2}});
  await page.evaluate(({media,root})=>window.libzci.imageOpen(media,{root,sort:'path'}),{media:imageId,root:managed});
  let viewer=await page.evaluate(()=>window.libzci.imageSnapshot());assert.equal(viewer.count,2);assert.equal(viewer.media,imageId);assert(viewer.facts);const origin=viewer.origin_revision;
  await page.evaluate(async root=>{
    const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('pictures'),source=await directory.getFileHandle('a.png'),target=await directory.getFileHandle('c.png',{create:true}),writer=await target.createWritable();await writer.write(await source.getFile());await writer.close();await window.libzci.catalogScan(root);
  },managed);await page.waitForFunction(()=>window.libzci.snapshot()?.scan?.state!=='scanning');
  assert.equal((await page.evaluate(root=>window.libzci.catalogQuery({root,kind:'image'}),managed)).total,3);
  await page.locator('#catalog-search').fill('no matching image');await page.locator('#catalog-search').dispatchEvent('change');
  await page.evaluate(()=>window.libzci.imageNavigate('next'));viewer=await page.evaluate(()=>window.libzci.imageSnapshot());assert.equal(viewer.count,2);assert.equal(viewer.origin_revision,origin);assert.notEqual(viewer.media,imageId);assert(viewer.facts);const last=viewer;
  await page.evaluate(()=>window.libzci.imageNavigate('next'));assert.equal((await page.evaluate(()=>window.libzci.imageSnapshot())).generation,last.generation);
  await page.locator('#image-wrap').setChecked(true);await page.evaluate(()=>window.libzci.imageNavigate('next'));assert.equal((await page.evaluate(()=>window.libzci.imageSnapshot())).media,imageId);
  await page.evaluate(()=>Promise.all([window.libzci.imageNavigate('last'),window.libzci.imageNavigate('first')]));viewer=await page.evaluate(()=>window.libzci.imageSnapshot());assert.equal(viewer.media,imageId);assert(viewer.facts);
  const refreshGeneration=viewer.generation;await page.locator('#image-edge').fill('1');await page.locator('#image-edge').dispatchEvent('change');await page.waitForFunction(g=>window.libzci.imageSnapshot()?.generation>g&&!!window.libzci.imageSnapshot()?.facts,refreshGeneration);assert.equal(await page.locator('#image-stage').evaluate(image=>image.naturalWidth),1);
  viewer=await page.evaluate(()=>window.libzci.imageSnapshot());await page.evaluate(()=>window.libzci.imageNavigate('refresh'));assert.equal((await page.evaluate(()=>window.libzci.imageSnapshot())).generation,viewer.generation+1);
  const independent=await page.evaluate(async media=>{const job=window.libzci.catalogRendition(media,64);window.libzci.imageClose();return job;},imageId);assert(independent.rendition);assert.equal((await page.evaluate(()=>window.libzci.imageSnapshot())).count,0);assert.equal(await page.evaluate(()=>window.imageUrls.size),0);
  await page.locator('#catalog-search').fill('');await page.locator('#catalog-search').dispatchEvent('change');
  results.push({test:'captured image navigation survives Library/query changes, wraps only on request, fences rapid jobs and isolates scoped cancellation while music plays'});
  const after=(await page.evaluate(()=>window.libzci.snapshot())).snapshot;assert.equal(after.generation,before.generation);assert.equal(after.requested,'Running');assert(after.position_frames>before.position_frames);await page.evaluate(()=>window.libzci.command('pause'));
  results.push({test:'artwork/image renditions, inspection, budget rejection and cancellation remain independent of playing music'});
  await page.locator('#file').setInputFiles(path.join(root,'.local/libzci/media/m3/artwork.opus'));await page.locator('#catalog-add-files').click();
  await page.locator('#catalog-rows button').filter({hasText:'Artwork'}).first().click();await page.waitForFunction(()=>document.querySelector('#artwork-image').naturalWidth===256);
  assert.equal(await page.evaluate(()=>window.imageUrls.size),1);await page.locator('#artwork-close').click();assert.equal(await page.evaluate(()=>window.imageUrls.size),0);assert.equal(await page.locator('#artwork-image').getAttribute('src'),null);
  results.push({test:'catalog artwork preview displays the shared rendition and releases its presentation-owned URL on close'});
  assert.deepEqual(errors,[]);
}finally{await writeFile(path.join(root,'.local/libzci/m3-images-evidence.json'),JSON.stringify({results,errors},null,2));await browser.close();await server.close();}
console.log(results);
