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
  const corrupt=Buffer.from(png(1,1,Buffer.from([0,0,0,255])));corrupt.writeUInt32BE(32768,16);corrupt.writeUInt32BE(32768,20);corrupt.writeUInt32BE(crc32(corrupt.subarray(12,29)),29);
  const denied=await page.evaluate(async bytes=>{const {ImageJob}=await import('/src/image-job.ts');try{await new ImageJob(new File([new Uint8Array(bytes)],'bomb.png'),{kind:'image',spec:{max_edge:64}}).result;return false;}catch(e){return e.kind==='resource-exhausted';}},Array.from(corrupt));assert(denied);
  const cancelled=await page.evaluate(async bytes=>{const {ImageJob}=await import('/src/image-job.ts');const job=new ImageJob(new File([new Uint8Array(bytes)],'test.png'),{kind:'image',spec:{max_edge:64}});job.cancel();try{await job.result;return false;}catch(e){return e.kind==='cancelled';}},Array.from(png(2,3,pixels)));assert(cancelled);
  await page.evaluate(async bytes=>window.libzci.load(new File([new Uint8Array(bytes)],'long.opus')),Array.from(await readFile(path.join(root,'.local/libzci/media/r3/long.opus'))));
  await page.waitForFunction(()=>window.libzci.snapshot()?.snapshot.state==='Ready');await page.evaluate(()=>window.libzci.command('volume',0.02));await page.evaluate(()=>window.libzci.command('play'));await page.waitForFunction(()=>window.libzci.snapshot()?.snapshot.position_frames>10000);
  const before=(await page.evaluate(()=>window.libzci.snapshot())).snapshot;
  const artwork=await job(await readFile(path.join(root,'.local/libzci/media/m3/artwork.opus')),{kind:'artwork',spec:{max_edge:64}});assert.deepEqual([artwork.rendition.width,artwork.rendition.height],[64,64]);assert.equal(artwork.facts.width,256);
  for(let n=0;n<3;n++)await job(png(2,3,pixels,6),{kind:'image',spec:{max_edge:2}});
  const after=(await page.evaluate(()=>window.libzci.snapshot())).snapshot;assert.equal(after.generation,before.generation);assert.equal(after.requested,'Running');assert(after.position_frames>before.position_frames);await page.evaluate(()=>window.libzci.command('pause'));
  results.push({test:'artwork/image renditions, inspection, budget rejection and cancellation remain independent of playing music'});
  await page.locator('#file').setInputFiles(path.join(root,'.local/libzci/media/m3/artwork.opus'));await page.locator('#catalog-add-files').click();
  await page.locator('#catalog-rows button').filter({hasText:'Artwork'}).first().click();await page.waitForFunction(()=>document.querySelector('#artwork-image').naturalWidth===256);
  assert.equal(await page.evaluate(()=>window.imageUrls.size),1);await page.locator('#artwork-close').click();assert.equal(await page.evaluate(()=>window.imageUrls.size),0);assert.equal(await page.locator('#artwork-image').getAttribute('src'),null);
  results.push({test:'catalog artwork preview displays the shared rendition and releases its presentation-owned URL on close'});
  assert.deepEqual(errors,[]);
}finally{await writeFile(path.join(root,'.local/libzci/m3-images-evidence.json'),JSON.stringify({results,errors},null,2));await browser.close();await server.close();}
console.log(results);
