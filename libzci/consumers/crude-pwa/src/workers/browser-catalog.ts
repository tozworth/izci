import {known_extension,normalize_metadata,type WebProfile} from '../generated/libzci_web.js';
import {Capabilities,type CapabilityStaging} from '../capabilities.js';
import {ProbeWorker} from '../probe-worker.js';
import {LyricsJob} from '../lyrics-job.js';
import type {CatalogCommand,CatalogOutcome,CatalogPage,CatalogQuery,CatalogGroupBy,CatalogGroupPage,ManagedRoot,MediaInput,ScanObservation,ScanPlan,ScanSettings} from '../catalog-types.js';
import type {RealDirectoryHandle,RealFileHandle,SourceReference} from '../profile-types.js';
import type {Facts} from './browser-providers.js';
interface Active {plan:ScanPlan;cancelled:boolean;pool:ProbeWorker[];staged:Set<string>}
const extension=(name:string)=>name.split('.').pop()?.toLowerCase()??'';
/** Browser mechanisms only. The shared Rust profile owns catalog queries,
 * metadata normalization, root settings, staged reconciliation and receipts. */
export class BrowserCatalog {
  private active:Active|null=null;
  private launch:number[]=[];
  private lyricJobs=new Set<LyricsJob>();
  observation:ScanObservation={state:'idle',root:null,visited:0,accepted:0,ignored:0,detail:''};
  constructor(private core:WebProfile,private handles:Capabilities,private files:Map<string,File>,private staging:CapabilityStaging,private publish:()=>void){}
  query(query:CatalogQuery={}):CatalogPage{return JSON.parse(this.core.catalog_query(JSON.stringify(query)));}
  groups(by:CatalogGroupBy,query:CatalogQuery={}):CatalogGroupPage{return JSON.parse(this.core.catalog_groups(by,JSON.stringify(query)));}
  roots():ManagedRoot[]{return JSON.parse(this.core.managed_roots());}
  bookmarks(media:number,subsong:number|null){return JSON.parse(this.core.bookmarks(BigInt(media),subsong??undefined));}
  async lyrics(media:number){
    if(this.lyricJobs.size>=4)throw new Error('Concurrent lyric job budget exhausted');
    const row=this.query({collection:'all',media,limit:1}).rows[0];if(!row)throw new Error('Unknown lyric media');
    const source=row.source;const file=source.kind==='browser_handle'?await this.handles.resolve(source.locator):this.files.get(source.key);
    if(!file)throw Object.assign(new Error('Lyric source is not currently accessible'),{kind:'access-required'});
    if(this.lyricJobs.size>=4)throw Object.assign(new Error('Concurrent lyric job budget exhausted'),{kind:'resource-exhausted'});
    const job=new LyricsJob(file);this.lyricJobs.add(job);try{return await job.result;}finally{this.lyricJobs.delete(job);}
  }
  cancelLyrics():void{for(const job of this.lyricJobs)job.cancel();this.lyricJobs.clear();}
  mutate(command:CatalogCommand,request?:string):CatalogOutcome{
    const outcome=JSON.parse(this.core.catalog_request(JSON.stringify(command),request)) as CatalogOutcome;
    if(!outcome.duplicate&&outcome.root&&this.active?.plan.root.id===outcome.root&&command.kind!=='finish_scan')this.cancel();
    this.publish();return outcome;
  }
  private async stage(handle:RealDirectoryHandle|RealFileHandle,key:string,local:Set<string>):Promise<string>{
    this.staging.protect(key,local);return this.handles.stage(handle,key,resolved=>this.staging.protect(resolved,local));
  }
  private release(staged:Set<string>):void{this.staging.release(staged);}
  private async recover():Promise<void>{await this.handles.recoverReferenced(key=>this.core.references_browser_capability(key),this.staging);}
  async addRoot(handle:RealDirectoryHandle,settings:ScanSettings,request:string):Promise<CatalogOutcome>{
    const staged=new Set<string>();
    try{
      const key=await this.stage(handle,`${request}/root`,staged);
      const source:SourceReference={key,locator:key,kind:'browser_handle',display_path:handle.name};
      const outcome=this.mutate({kind:'root',root:{source,settings}},request);await this.handles.complete(key);return outcome;
    }finally{this.release(staged);}
  }
  private media(source:SourceReference,file:File,facts:Facts):MediaInput{
    return {source,source_revision:`${file.size}:${file.lastModified}`,kind:['org.openmpt.libopenmpt','hivelytracker.replay'].includes(facts.provider.id)?'module':'audio',metadata:JSON.parse(normalize_metadata(JSON.stringify(facts.comments),facts.total===null?undefined:facts.total/facts.rate,source.display_path))};
  }
  async addFiles(files:File[],handles:RealFileHandle[],verifyUnknown:boolean,request:string):Promise<CatalogOutcome>{
    if(!files.length||files.length>256||handles.length&&handles.length!==files.length)throw new Error('Catalog batch must contain 1..256 files');
    const worker=new ProbeWorker(),staged=new Set<string>(),media:MediaInput[]=[];
    try{
      for(const [index,file] of files.entries()){
        const handle=handles[index];const key=handle?await this.stage(handle,`${request}/${index}`,staged):`${request}/${index}`;
        const facts=await worker.inspect(file,verifyUnknown);
        media.push(this.media({key,locator:key,kind:handle?'browser_handle':'ephemeral',display_path:file.name},file,facts));
      }
      const outcome=this.mutate({kind:'add',media},request);
      for(const [index,input] of media.entries()){if(input.source.kind==='browser_handle')await this.handles.complete(input.source.locator);else this.files.set(input.source.key,files[index]!);}
      return outcome;
    }finally{worker.close();this.release(staged);}
  }
  launchScans():void{this.launch=this.roots().filter(r=>r.config.settings.scan_on_launch).map(r=>r.id);this.nextLaunch();}
  private nextLaunch():void{const root=this.launch.shift();if(root!==undefined)this.start(root,false);}
  start(root:number,manual=true):void{
    if(manual)this.launch=[];
    this.cancel(false);
    const plan=JSON.parse(this.core.begin_scan(BigInt(root))) as ScanPlan;
    const active:Active={plan,cancelled:false,pool:[],staged:new Set()};this.active=active;
    this.observation={state:'scanning',root,visited:0,accepted:0,ignored:0,detail:'Checking directory access'};this.publish();
    void this.run(active).catch(error=>{if(this.active===active)this.active=null;this.observation={...this.observation,state:'failed',detail:String(error)};this.publish();});
  }
  cancel(clearLaunch=true):void{
    if(clearLaunch)this.launch=[];
    const active=this.active;if(!active)return;
    active.cancelled=true;for(const worker of active.pool)worker.close();this.active=null;
    this.observation={...this.observation,state:'idle',detail:'Scan cancelled; prior Library preserved'};
    try{this.core.cancel_scan(active.plan.token);}catch(error){this.observation={...this.observation,state:'failed',detail:`Scan cancelled; staging cleanup failed: ${String(error)}`};this.publish();throw error;}
    this.publish();
  }
  private async run(active:Active):Promise<void>{
    const check=()=>{if(active.cancelled||this.active!==active)throw Object.assign(new Error('Scan cancelled'),{kind:'cancelled'});};
    const tasks=new Set<Promise<void>>();let failure:unknown=null;
    const available:ProbeWorker[]=[];
    try{
      const directory=await this.handles.directory(active.plan.root.config.source.locator);check();
      for(let n=0;n<active.plan.root.config.settings.probe_concurrency;n++){const worker=new ProbeWorker();active.pool.push(worker);available.push(worker);}
      for await(const {handle,path} of this.enumerate(directory,active,check)){
        check();if(failure)throw failure;
        if(!known_extension(extension(handle.name))&&!active.plan.root.config.settings.verify_unknown){this.observation.ignored++;continue;}
        if(tasks.size===active.pool.length){await Promise.race(tasks);check();if(failure)throw failure;}
        const worker=available.pop()!;
        let task:Promise<void>;
        task=(async()=>{
          const file=await handle.getFile();check();
          let facts:Facts;
          try{facts=await worker.inspect(file,active.plan.root.config.settings.verify_unknown);}
          catch(error){if(!known_extension(extension(file.name))&&['unsupported','corrupt'].includes((error as {kind?:string}).kind??'')){this.observation.ignored++;return;}throw error;}
          check();
          const after=await handle.getFile();check();if(after.size!==file.size||after.lastModified!==file.lastModified)throw new Error(`Source changed during scan: ${path}`);
          // Stable path candidates make ordinary rescans a direct lookup. Real
          // isSameEntry checks still arbitrate identity, including nested roots
          // and files previously imported through a picker.
          const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(path)))).map(n=>n.toString(16).padStart(2,'0')).join('');check();
          const key=await this.stage(handle,`${active.plan.root.config.source.key}/file/${digest}`,active.staged);check();
          const input=this.media({key,locator:key,kind:'browser_handle',display_path:`${active.plan.root.config.source.display_path}/${path}`},file,facts);
          this.core.stage_scan(active.plan.token,JSON.stringify([input]));this.observation.accepted++;
          if(this.observation.accepted%32===0)this.publish();
        })().catch(error=>{failure??=error;}).finally(()=>{available.push(worker);tasks.delete(task);});
        tasks.add(task);
      }
      await Promise.all(tasks);check();if(failure)throw failure;
      const outcome=this.mutate({kind:'finish_scan',token:active.plan.token});
      this.observation={...this.observation,state:'idle',detail:`Scan complete: ${outcome.scan!.entries} media, ${outcome.scan!.added} added, ${outcome.scan!.removed} removed`};
    }catch(error){
      if(this.active===active){
        let cleanup='';try{this.core.cancel_scan(active.plan.token);}catch(e){cleanup=`; staging cleanup failed: ${String(e)}`;}
        this.observation={...this.observation,state:'failed',detail:`${(error as {kind?:string}).kind??'scan-failed'}: ${String(error)}${cleanup}`};
      }
    }finally{
      for(const worker of active.pool)worker.close();await Promise.allSettled(tasks);this.release(active.staged);
      // Only the current operation publishes status; an old cancelled scan
      // must not overwrite the replacement's progress or capability protection.
      if(this.active===active){this.active=null;try{await this.recover();}catch(e){this.observation.detail+=`; capability cleanup: ${String(e)}`;}this.publish();this.nextLaunch();}
    }
  }
  private async *enumerate(directory:RealDirectoryHandle,active:Active,check:()=>void,path='',depth=0):AsyncGenerator<{handle:RealFileHandle;path:string}>{
    if(depth>=64)throw new Error('Scan directory depth exceeds 64');
    for await(const handle of directory.values()){
      check();if(++this.observation.visited>1_000_000)throw new Error('Scan visited-entry budget exceeded');
      const relative=path?`${path}/${handle.name}`:handle.name;
      if(handle.kind==='file')yield {handle,path:relative};
      else if(active.plan.root.config.settings.recursive)yield* this.enumerate(handle,active,check,relative,depth+1);
    }
  }
}
