import type {RealDirectoryHandle,RealFileHandle} from './profile-types.js';
type Handle=RealFileHandle|RealDirectoryHandle;
interface Entry {key:string;name:string;handle:Handle;pending:boolean}
export class CapabilityStaging {
  private counts=new Map<string,number>();
  protect(key:string,operation:Set<string>):void{if(operation.has(key))return;operation.add(key);this.counts.set(key,(this.counts.get(key)??0)+1);}
  release(operation:Set<string>):void{for(const key of operation){const count=this.counts.get(key)??0;if(count<=1)this.counts.delete(key);else this.counts.set(key,count-1);}operation.clear();}
  has(key:string):boolean{return this.counts.has(key);}
}
/** Real capabilities only; isSameEntry determines identity, never file bytes. */
export class Capabilities {
  private db:Promise<IDBDatabase>;
  private identity=Promise.resolve();
  constructor(profile:string) {
    this.db=new Promise((resolve,reject)=>{const request=indexedDB.open(`libzci-crude-capabilities-v2-${profile}`,2);
      request.onupgradeneeded=()=>{
        const store=request.result.objectStoreNames.contains('handles')?request.transaction!.objectStore('handles'):request.result.createObjectStore('handles',{keyPath:'key'});
        if(!store.indexNames.contains('by-name'))store.createIndex('by-name',['name','key'],{unique:true});
      };
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }
  private async run<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
    const db=await this.db;return new Promise((resolve,reject)=>{
      const transaction=db.transaction('handles',mode);const request=action(transaction.objectStore('handles'));
      transaction.oncomplete=()=>resolve(request.result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error??new Error('Capability transaction aborted'));
    });
  }
  private async *entries(name?:string):AsyncGenerator<Entry> {
    let after='';
    for(;;){
      const batch:Entry[]=await this.run('readonly',s=>name===undefined?s.getAll(after?IDBKeyRange.lowerBound(after,true):undefined,128):s.index('by-name').getAll(IDBKeyRange.bound([name,after],[name,[]],true,true),128));
      if(!batch.length)return;
      for(const entry of batch)yield entry;
      after=batch[batch.length-1]!.key;
    }
  }
  async stage(handle:Handle,key:string=crypto.randomUUID(),protect:(key:string)=>void=()=>{}):Promise<string> {
    if(!(handle instanceof FileSystemFileHandle)&&!(handle instanceof FileSystemDirectoryHandle))throw new Error('A genuine file or directory handle is required');
    const operation=this.identity.then(async()=>{
      const existing=await this.get(key);
      if(existing){if(!await existing.handle.isSameEntry(handle))throw new Error('Capability identity collision');protect(key);return key;}
      for await(const entry of this.entries(handle.name))if(entry.handle.kind===handle.kind&&await entry.handle.isSameEntry(handle)){protect(entry.key);return entry.key;}
      protect(key);
      await this.run('readwrite',s=>s.put({key,name:handle.name,handle,pending:true} satisfies Entry));return key;
    });
    this.identity=operation.then(()=>{},()=>{});return operation;
  }
  async complete(key:string):Promise<void> {const entry=await this.get(key);if(!entry)throw new Error('Capability missing after SQL commit');await this.run('readwrite',s=>s.put({...entry,pending:false}));}
  get(key:string):Promise<Entry|undefined> {return this.run('readonly',s=>s.get(key));}
  async recover(live:Set<string>|(()=>Set<string>),staging:{has:(key:string)=>boolean}=new Set<string>()):Promise<void> {
    return this.recoverReferenced(key=>(typeof live==='function'?live():live).has(key),staging);
  }
  async recoverReferenced(live:(key:string)=>boolean,staging:{has:(key:string)=>boolean}=new Set<string>()):Promise<void> {
    const operation=this.identity.then(async()=>{for await(const entry of this.entries()) {
      if(staging.has(entry.key))continue;
      if(!live(entry.key))await this.run('readwrite',s=>s.delete(entry.key));else if(entry.pending)await this.complete(entry.key);
    }});
    this.identity=operation.then(()=>{},()=>{});return operation;
  }
  async resolve(key:string):Promise<File> {
    const entry=await this.get(key);
    if(!entry||entry.handle.kind!=='file')throw {kind:'unavailable',detail:'File handle is missing; choose the file again'};
    if(await entry.handle.queryPermission({mode:'read'})!=='granted')throw {kind:'access-required',detail:'Access required; use Grant access and retry'};
    try{return await entry.handle.getFile();}catch(e){throw {kind:(e as DOMException).name==='NotAllowedError'?'access-required':'unavailable',detail:String(e)};}
  }
  async directory(key:string):Promise<RealDirectoryHandle> {
    const entry=await this.get(key);
    if(!entry||entry.handle.kind!=='directory')throw {kind:'unavailable',detail:'Directory handle is missing; choose it again'};
    if(await entry.handle.queryPermission({mode:'read'})!=='granted')throw {kind:'access-required',detail:'Directory access required; grant it explicitly and retry'};
    return entry.handle;
  }
  async grant(key:string):Promise<void> {
    const entry=await this.get(key);if(!entry)throw new Error('File or directory handle is missing');
    if(await entry.handle.requestPermission({mode:'read'})!=='granted')throw new Error('Access denied; saved state and handle preserved');
  }
}
