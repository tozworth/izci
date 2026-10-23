import init,{WebProfile} from '../src/generated/libzci_web.js';
import {openDatabase} from '../src/workers/profile-storage.js';
const assert=(v:unknown,message:string)=>{if(!v)throw new Error(message);};
self.onmessage=async()=>{try {
  await init();const {db,statement}=await openDatabase(`storage-proof-${crypto.randomUUID()}`);
  let fault='';const bridge=(sql:string,args:string)=>{if(sql.startsWith(fault)&&fault)throw Object.assign(new Error('injected failure'),{code:fault==='BEGIN'?'busy':'quota'});return statement(sql,args);};
  let profile=new WebProfile(bridge);
  profile.command(JSON.stringify({kind:'volume',volume:0.41}));profile.free();profile=new WebProfile(bridge);
  assert(Math.abs(JSON.parse(profile.snapshot()).settings.volume-0.41)<1e-7,'shared Rust SQL setting survives real OPFS reopen');
  const source={key:'one',kind:'ephemeral',locator:'one',display_path:'one.wav'};
  profile.request(JSON.stringify({kind:'append',sources:[source,source]}),'append-1');
  let before=profile.snapshot();
  for(const at of ['BEGIN','INSERT INTO queue','COMMIT']) {
    fault=at;let failed=false;try {profile.command(JSON.stringify({kind:'append',sources:[source]}));}catch{failed=true;}
    assert(failed,`expected injected ${at} failure`);assert(profile.snapshot()===before,`${at} published no durable revision`);
    fault='';profile.free();profile=new WebProfile(bridge);assert(profile.snapshot()===before,`${at} preserved real SQLite data`);
  }
  // SQLite enforces a real file-page limit. This exercises SQLITE_FULL rather
  // than claiming that mocked bridge failures exhaust browser disk quota.
  const pageCount=JSON.parse(statement('PRAGMA page_count','[]'))[0][0];statement(`PRAGMA max_page_count=${pageCount}`,'[]');
  let full=false;try{profile.command(JSON.stringify({kind:'append',sources:Array.from({length:100},(_,n)=>({...source,key:`large-${n}`,locator:'x'.repeat(8000)}))}));}catch{full=true;}
  assert(full,'real SQLite page quota must fail');assert(profile.snapshot()===before,'quota publishes no revision');
  statement('PRAGMA max_page_count=2147483646','[]');profile.free();profile=new WebProfile(bridge);assert(profile.snapshot()===before,'quota preserves OPFS data');
  const duplicate=JSON.parse(profile.request(JSON.stringify({kind:'append',sources:[source,source]}),'append-1'));assert(duplicate.duplicate,'receipt survives reopen');assert(profile.snapshot()===before,'duplicate does not publish or append');
  statement('PRAGMA user_version=999','[]');profile.free();let schema=false;try{new WebProfile(bridge);}catch{schema=true;}assert(schema,'unknown schema rejected');
  assert(JSON.parse(statement('SELECT count(*) FROM queue_occurrences','[]'))[0][0]===2,'schema failure leaves rows intact');
  db.close();self.postMessage({passed:['one shared SQL setting committed/reopened','duplicates','busy/quota/commit injection rollback','real SQLite page quota','durable retry receipt','schema refusal preserves data']});
}catch(e){self.postMessage({error:String(e)});}};
