import { defineConfig, type Plugin } from 'vite';
import {readFile} from 'node:fs/promises';

/** Inventory actual emitted workers/loaders/WASM, including nested workers. */
function offline():Plugin {return {name:'libzci-offline',apply:'build',async generateBundle(_options,bundle){
  const encoder=new TextEncoder();
  const digest=async (bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const publicAssets=await Promise.all(['manifest.webmanifest','icon-192.png','icon-512.png'].map(async name=>{const bytes=await readFile(new URL(`./public/${name}`,import.meta.url));return {url:`/${name}`,bytes:bytes.byteLength,sha256:await digest(bytes)};}));
  const inventory=async()=>Promise.all(Object.entries(bundle).filter(([name])=>!name.endsWith('.map')).map(async ([name,asset])=>{const bytes=asset.type==='chunk'?encoder.encode(asset.code):typeof asset.source==='string'?encoder.encode(asset.source):asset.source;return {url:`/${name}`,bytes:bytes.byteLength,sha256:await digest(bytes)};}));
  const version=(await digest(encoder.encode(JSON.stringify([...(await inventory()),...publicAssets])))).slice(0,24);
  const html=bundle['index.html'];if(html?.type==='asset'&&typeof html.source==='string')html.source=html.source.replace('__LIBZCI_VERSION__',version);
  const assets=[...await inventory(),...publicAssets];
  const urls=['/','/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png',...assets.map(a=>a.url),'/asset-identity.json'];
  this.emitFile({type:'asset',fileName:'asset-identity.json',source:JSON.stringify({api:1,version,assets},null,2)});
  this.emitFile({type:'asset',fileName:'sw.js',source:`
const VERSION=${JSON.stringify(version)}, CACHE='libzci-crude-v1-'+VERSION, URLS=${JSON.stringify([...new Set(urls)])}, ASSETS=${JSON.stringify(assets)};
const versions=new Map();
async function cleanup(){const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});if(clients.some(c=>!versions.has(c.id)))return;const live=new Set([VERSION,...clients.map(c=>versions.get(c.id))]);for(const name of await caches.keys())if(name.startsWith('libzci-crude-v1-')&&!live.has(name.slice('libzci-crude-v1-'.length)))await caches.delete(name);}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  try {for(const url of URLS){const response=await fetch(url,{cache:'reload'});const bytes=await response.clone().arrayBuffer();const expected=ASSETS.find(a=>a.url===url);if(!response.ok||!bytes.byteLength||expected&&bytes.byteLength!==expected.bytes)throw new Error('Offline asset unavailable or wrong size: '+url);await cache.put(url,response);}}
  catch(error){await caches.delete(CACHE);throw error;}
})()));
// No automatic skipWaiting: running clients retain their complete hashed assets.
self.addEventListener('message',event=>{if(event.data?.type==='activate')self.skipWaiting();else if(event.data?.type==='client-version'&&event.source?.id){versions.set(event.source.id,event.data.version);event.waitUntil(cleanup());}});
self.addEventListener('activate',event=>event.waitUntil((async()=>{await self.clients.claim();await cleanup();})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(event.request.mode==='navigate')return (await cache.match('/index.html'))||fetch(event.request);
    return (await cache.match(event.request))||(await caches.match(event.request))||fetch(event.request);
  })());
});`});
}};}

// Independent crude consumer: dedicated origin/port, own build
// directory, no shared scope with the main izci app. Ordinary proof
// page in Phase 1.3 — manifest/SW/install support lands in 3.4.
export default defineConfig({
  plugins:[offline()],
  server: {
    port: 5197,
    strictPort: true,
  },
  preview: {
    port: 5197,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    assetsInlineLimit:0,
  },
});
