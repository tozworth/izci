// Fault injection belongs in the worker realm that actually owns storage and
// source access. OPFS/IDB, shared core and production BrowserCatalog are real.
import init from '../src/generated/libzci_web.js';
import {openProfile} from '../src/workers/profile-storage.js';
import {BrowserCatalog} from '../src/workers/browser-catalog.js';
import {Capabilities,CapabilityStaging} from '../src/capabilities.js';
import type {RealFileHandle} from '../src/profile-types.js';
self.onmessage=async event=>{try{
  await init();const name='cache-faults',core=await openProfile(name);
  const catalog=new BrowserCatalog(name,core,new Capabilities(name),new Map(),new CapabilityStaging(),()=>{});
  const directory=await navigator.storage.getDirectory(),handle=await directory.getFileHandle('cache-fault.png',{create:true}),writer=await handle.createWritable();await writer.write(new Uint8Array(event.data));await writer.close();
  const added=await catalog.addFiles([await handle.getFile()],[handle as unknown as RealFileHandle],false,crypto.randomUUID()),media=added.media[0]!;
  await catalog.rendition(media,2);const cached=(await catalog.rendition(media,2)).cache==='hit',before=core.snapshot();
  const prototype=FileSystemHandle.prototype as unknown as {queryPermission:(...args:unknown[])=>Promise<string>},permission=prototype.queryPermission;let denied=false;
  try{prototype.queryPermission=async()=> 'denied';try{await catalog.rendition(media,2);}catch(e){denied=(e as {kind?:string}).kind==='access-required';}}finally{prototype.queryPermission=permission;}
  const put=IDBObjectStore.prototype.put;let quota='';
  try{IDBObjectStore.prototype.put=function(...args:Parameters<typeof put>){if(this.name==='png')throw new DOMException('injected cache quota','QuotaExceededError');return put.apply(this,args);};quota=(await catalog.rendition(media,3)).cache;}finally{IDBObjectStore.prototype.put=put;}
  const preserved=core.snapshot()===before;core.free();self.postMessage({denied,cached,quota,preserved});
}catch(e){self.postMessage({error:String(e)});}};
