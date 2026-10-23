import type {RealFileHandle} from './profile-types.js';
interface Entry {key:string;handle:RealFileHandle;pending:boolean}
/** Real capabilities only; SQL references never serialize a handle or media bytes. */
export class Capabilities {
  private db:Promise<IDBDatabase>;
  constructor(profile:string) {
    this.db=new Promise((resolve,reject)=>{const request=indexedDB.open(`libzci-crude-capabilities-v1-${profile}`,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('handles',{keyPath:'key'});
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }
  private async run<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
    const db=await this.db;return new Promise((resolve,reject)=>{
      const transaction=db.transaction('handles',mode);const request=action(transaction.objectStore('handles'));
      transaction.oncomplete=()=>resolve(request.result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error??new Error('Capability transaction aborted'));
    });
  }
  async stage(handle:RealFileHandle,key:string=crypto.randomUUID()):Promise<string> {
    if(!(handle instanceof FileSystemFileHandle))throw new Error('A genuine file handle is required');
    if(await this.get(key))return key;
    await this.run('readwrite',s=>s.put({key,handle,pending:true} satisfies Entry));return key;
  }
  async complete(key:string):Promise<void> {const entry=await this.get(key);if(!entry)throw new Error('Capability missing after SQL commit');await this.run('readwrite',s=>s.put({...entry,pending:false}));}
  get(key:string):Promise<Entry|undefined> {return this.run('readonly',s=>s.get(key));}
  async recover(live:Set<string>|(()=>Set<string>),staging=new Set<string>()):Promise<void> {
    const entries:Entry[]=await this.run('readonly',s=>s.getAll());
    // Pending+referenced means SQL committed before a crash. Unreferenced entries
    // (pending or complete) are safe orphans; deleting a handle never revokes grants.
    for(const entry of entries) {
      if(staging.has(entry.key))continue;
      const references=typeof live==='function'?live():live;
      if(!references.has(entry.key))await this.run('readwrite',s=>s.delete(entry.key));else if(entry.pending)await this.complete(entry.key);
    }
  }
  async resolve(key:string):Promise<File> {
    const entry=await this.get(key);
    if(!entry)throw {kind:'unavailable',detail:'File handle is missing; choose the file again'};
    if(await entry.handle.queryPermission({mode:'read'})!=='granted')throw {kind:'access-required',detail:'Access required; use Grant access and retry'};
    try{return await entry.handle.getFile();}catch(e){throw {kind:(e as DOMException).name==='NotAllowedError'?'access-required':'unavailable',detail:String(e)};}
  }
  async grant(key:string):Promise<void> {
    const entry=await this.get(key);if(!entry)throw new Error('File handle is missing');
    if(await entry.handle.requestPermission({mode:'read'})!=='granted')throw new Error('Access denied; saved queue and handle preserved');
  }
}
