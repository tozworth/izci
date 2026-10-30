import init,{WebProfile} from '../src/generated/libzci_web.js';
import {openDatabase} from '../src/workers/profile-storage.js';
import {Capabilities,CapabilityStaging} from '../src/capabilities.js';
import type {RealFileHandle} from '../src/profile-types.js';
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
  const add={kind:'add',media:[{source,kind:'audio',source_revision:'1',metadata:{title:'Library test',artist:'Artist',album:'Album'}}]};
  const added=JSON.parse(profile.catalog_request(JSON.stringify(add),'catalog-add'));
  const media=added.media[0];assert(Number.isSafeInteger(media),'catalog ID is JSON-safe');
  profile.catalog_request(JSON.stringify({kind:'favorite',media,subsong:null,favorite:true}));
  profile.catalog_request(JSON.stringify({kind:'rate',media,subsong:0,rating:7}));
  profile.catalog_request(JSON.stringify({kind:'bookmark',media,subsong:0,position_seconds:2.5,label:'Marker'}));
  const page=JSON.parse(profile.catalog_query(JSON.stringify({collection:'favorites'})));
  assert(page.total===1&&page.rows[0].id===media,'OPFS catalog/favorite query');
  const revision=page.revision;
  profile.command(JSON.stringify({kind:'checkpoint',position_seconds:1,subsong:null}));
  assert(JSON.parse(profile.catalog_query(JSON.stringify({revision}))).revision===revision,'playback checkpoint does not invalidate catalog pages');
  before=profile.snapshot();
  for(const at of ['INSERT INTO media','INSERT INTO request_receipts','COMMIT']) {
    fault=at;let failed=false;try {profile.catalog_request(JSON.stringify({...add,media:[{...add.media[0],source:{...source,key:'bad'}}]}),'bad-catalog-add');}catch{failed=true;}
    assert(failed,`catalog ${at} failure`);assert(profile.snapshot()===before,'failed catalog command publishes nothing');fault='';
    assert(JSON.parse(profile.catalog_query('{}')).total===1,'catalog insert rolled back');
  }
  profile.free();profile=new WebProfile(bridge);
  assert(JSON.parse(profile.catalog_request(JSON.stringify(add),'catalog-add')).duplicate,'catalog receipt survives OPFS reopen');
  assert(JSON.parse(profile.catalog_query(JSON.stringify({subsong:0}))).rows[0].facts.rating===7,'subsong facts survive OPFS reopen');
  assert(JSON.parse(profile.bookmarks(BigInt(media),0))[0].position_seconds===2.5,'bookmark survives OPFS reopen');
  const root=JSON.parse(profile.catalog_request(JSON.stringify({kind:'root',root:{source:{key:'root',kind:'browser_handle',locator:'root-capability',display_path:'Music'},settings:{}}}))).root;
  let scan=JSON.parse(profile.begin_scan(BigInt(root)));
  const scanned={source:{...source,key:'scanned'},kind:'audio',source_revision:'1',metadata:{title:'Scanned'}};
  assert(profile.stage_scan(scan.token,JSON.stringify([scanned,scanned]))===1n,'scan staging deduplicates by identity');
  assert(JSON.parse(profile.catalog_query('{}')).total===1,'staging does not publish catalog');
  const finished=JSON.parse(profile.catalog_request(JSON.stringify({kind:'finish_scan',token:scan.token}),'finish-scan'));
  assert(finished.scan.added===1,'OPFS root reconciliation');
  assert(JSON.parse(profile.catalog_query(JSON.stringify({root}))).total===1,'root-scoped query');
  assert(JSON.parse(profile.catalog_request(JSON.stringify({kind:'finish_scan',token:scan.token}),'finish-scan')).duplicate,'scan finish retry is idempotent after staging is released');
  scan=JSON.parse(profile.begin_scan(BigInt(root)));profile.cancel_scan(scan.token);
  let cancelled=false;try{profile.catalog_request(JSON.stringify({kind:'finish_scan',token:scan.token}));}catch{cancelled=true;}
  assert(cancelled&&JSON.parse(profile.catalog_query('{}')).total===2,'cancelled scan preserves catalog');
  scan=JSON.parse(profile.begin_scan(BigInt(root)));profile.stage_scan(scan.token,JSON.stringify([{...scanned,source:{...source,key:'partial'}}]));
  profile.free();profile=new WebProfile(bridge);
  // The same SQL connection keeps its transient job; freeing a binding does
  // not close the DB. Actual connection loss drops TEMP tables.
  profile.cancel_scan(scan.token);
  assert(JSON.parse(profile.managed_roots()).length===1,'managed roots persist');
  scan=JSON.parse(profile.begin_scan(BigInt(root)));
  const empty=JSON.parse(profile.catalog_request(JSON.stringify({kind:'finish_scan',token:scan.token})));
  assert(empty.scan.removed===1&&JSON.parse(profile.catalog_query('{}')).total===1,'only successful empty scan removes root membership');
  const handles=new Capabilities(`capabilities-${crypto.randomUUID()}`),staging=new CapabilityStaging();
  const capabilityRoot=await(await navigator.storage.getDirectory()).getDirectoryHandle(`capability-proof-${crypto.randomUUID()}`,{create:true});
  const handle=await capabilityRoot.getFileHandle('test.wav',{create:true}) as RealFileHandle;
  const first=new Set<string>(),second=new Set<string>();
  const key=await handles.stage(handle,'first',key=>staging.protect(key,first));
  const same=await handles.stage(handle,'second',key=>staging.protect(key,second));assert(key===same,'real isSameEntry identity reuse');
  staging.release(first);await handles.recoverReferenced(()=>false,staging);assert(await handles.get(key),'one remaining operation still protects shared capability');
  staging.release(second);
  // Identity discovery and cleanup serialize together; actual identity is
  // protected before the registration lock can be handed to recovery.
  const race=new Set<string>();
  await Promise.all([handles.stage(handle,'third',key=>staging.protect(key,race)),handles.recoverReferenced(()=>false,staging)]);
  assert(await handles.get(key),'identity/GC race preserves the staged handle');
  const actualSource={key,kind:'browser_handle',locator:key,display_path:'test.wav'};
  profile.catalog_request(JSON.stringify({...add,media:[{...add.media[0],source:actualSource}]}));staging.release(race);
  await handles.recoverReferenced(key=>profile.references_browser_capability(key),staging);
  assert(await handles.get(key),'catalog-only reference retains the capability without a queue row');
  assert(profile.references_source(key),'source reference liveness includes catalog');
  const albums=JSON.parse(profile.catalog_groups('album','{}'));
  assert(albums.total===1&&albums.groups[0].count===2&&albums.groups[0].key[0]==='Artist','shared OPFS album/artist grouping');
  assert(JSON.parse(profile.catalog_query(JSON.stringify({source_key:key}))).rows[0].source.key===key,'indexed source identity query');
  statement('PRAGMA user_version=999','[]');profile.free();let schema=false;try{new WebProfile(bridge);}catch{schema=true;}assert(schema,'unknown schema rejected');
  assert(JSON.parse(statement('SELECT count(*) FROM queue_occurrences','[]'))[0][0]===2,'schema failure leaves rows intact');
  db.close();self.postMessage({passed:['one shared SQL setting committed/reopened','duplicates','busy/quota/commit injection rollback','real SQLite page quota','durable retry receipt','schema refusal preserves data','catalog/favorites/subsong ratings/bookmarks OPFS reopen','catalog transaction rollback and durable receipts','independent catalog revision during playback checkpoints','managed root staging/reconciliation/cancellation and finish receipts','real capability identity sharing, overlapping staging, GC serialization and catalog liveness','shared grouped OPFS queries and indexed identity lookup']});
}catch(e){self.postMessage({error:String(e)});}};
