import {image_cache_plan} from './generated/libzci_web.js';
import type {CachedRendition} from './image-job.js';
export interface CacheBudget {bytes:number;entries:number}
interface Entry {key:string;bytes:number;touched:number;metadata:CachedRendition}
interface Plan {evict:string[];touch:number;store:boolean}
/** Separate rebuildable IDB. Shared Rust owns policy; each manifest/PNG change
 * commits atomically. Domain SQL never receives visual payloads. */
export class RenditionCache {
  private db:Promise<IDBDatabase>;
  readonly stats={hits:0,misses:0,failures:0};
  constructor(profile:string,private budget:CacheBudget={bytes:64*1024*1024,entries:256}){
    this.db=new Promise((resolve,reject)=>{
      const request=indexedDB.open(`libzci-artwork-cache-v1-${profile}`,1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('metadata',{keyPath:'key'});request.result.createObjectStore('png');};
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>reject(request.error);
    });
    void this.db.catch(()=>{});
  }
  private async run<T>(action:(tx:IDBTransaction,done:(value:T)=>void)=>void):Promise<T>{
    const db=await this.db;return new Promise((resolve,reject)=>{
      const tx=db.transaction(['metadata','png'],'readwrite');let result:T;
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Rendition cache transaction aborted'));
      try{action(tx,value=>{result=value;});}catch(e){tx.abort();reject(e);}
    });
  }
  private plan(tx:IDBTransaction,key:string,bytes:number,action:(plan:Plan)=>void):void {
    const metadata=tx.objectStore('metadata'),png=tx.objectStore('png'),request=metadata.getAll(undefined,4097);
    request.onsuccess=()=>{try{
      const entries=(request.result as Entry[]).map(({key,bytes,touched})=>({key,bytes,touched}));
      const plan=JSON.parse(image_cache_plan(JSON.stringify(entries),key,bytes,JSON.stringify(this.budget))) as Plan;
      for(const key of plan.evict){metadata.delete(key);png.delete(key);}action(plan);
    }catch{tx.abort();}};
  }
  async get(key:string):Promise<{metadata:CachedRendition;png:Blob}|null>{
    return this.run((tx,done)=>{
      const metadata=tx.objectStore('metadata'),request=metadata.get(key);
      request.onsuccess=()=>{
        const entry=request.result as Entry|undefined;if(!entry){done(null);return;}
        this.plan(tx,key,entry.bytes,plan=>{
          if(!plan.store){done(null);return;}
          const blob=tx.objectStore('png').get(key);blob.onsuccess=()=>{
            if(!(blob.result instanceof Blob)||blob.result.size!==entry.bytes||entry.bytes>8*1024*1024){metadata.delete(key);tx.objectStore('png').delete(key);done(null);return;}
            metadata.put({...entry,touched:plan.touch});done({metadata:entry.metadata,png:blob.result});
          };
        });
      };
    });
  }
  async put(key:string,metadata:CachedRendition,png:Uint8Array):Promise<void>{
    await this.run<void>((tx,done)=>this.plan(tx,key,png.byteLength,plan=>{
      if(plan.store){tx.objectStore('metadata').put({key,bytes:png.byteLength,touched:plan.touch,metadata} satisfies Entry);tx.objectStore('png').put(new Blob([png],{type:'image/png'}),key);}done();
    }));
  }
  async remove(key:string):Promise<void>{await this.run<void>((tx,done)=>{tx.objectStore('metadata').delete(key);tx.objectStore('png').delete(key);done();});}
  async clear():Promise<void>{await this.run<void>((tx,done)=>{tx.objectStore('metadata').clear();tx.objectStore('png').clear();done();});}
}
