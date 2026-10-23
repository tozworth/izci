import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import sqliteWasm from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import {WebProfile} from '../generated/libzci_web.js';
export async function openDatabase(name:string) {
  const sqlite=await (sqlite3InitModule as unknown as (options:{locateFile:()=>string})=>ReturnType<typeof sqlite3InitModule>)({locateFile:()=>sqliteWasm});
  const pool=await sqlite.installOpfsSAHPoolVfs({directory:`/libzci-crude-v1/${name}`,initialCapacity:6,clearOnInit:false,preserveOnInitFailure:true});
  const db=new pool.OpfsSAHPoolDb('/profile.sqlite3');
  const statement=(sql:string,args:string)=>{
      try {return JSON.stringify(db.exec({sql,bind:JSON.parse(args),rowMode:'array',returnValue:'resultRows'}));}
      catch(e) {const code=(e as {resultCode?:number}).resultCode;
        throw Object.assign(new Error(String(e)),{code:code===5||code===6?'busy':code===13?'quota':code===11||code===26?'corrupt':'io'});
      }
    };
  return {db,statement,pool};
}
export async function openProfile(name:string):Promise<WebProfile> {
  let database:Awaited<ReturnType<typeof openDatabase>>;
  try {database=await openDatabase(name);}catch(e){throw {kind:'storage-failure',code:'init',detail:`OPFS SQLite initialization failed: ${String(e)}`};}
  const {db,statement}=database;
  try {
    return new WebProfile(statement);
  }catch(e){db.close();throw e;}
}
