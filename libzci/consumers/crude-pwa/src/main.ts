import { BrowserRuntime } from './browser-runtime.js';
import type {Observation} from './runtime.js';
import type {CommandKind} from './protocol.js';
import { FileJob } from './file-job.js';
import {queueView} from './queue-view.js';
import {installPwa} from './pwa.js';
const byId=<T extends HTMLElement>(id:string):T=>document.getElementById(id) as T;
let runtime!:BrowserRuntime;
let disposed=false;
let latest:Observation | null=null;
const lines:string[]=[];
function log(message:string):void {
  lines.push(message);if(lines.length>40) lines.shift();byId('diagnostics').textContent=lines.join('\n');
}
function table(id:string,rows:[string,unknown][]):void {
  const target=byId(id);target.replaceChildren();
  for(const [name,value] of rows) {
    const row=document.createElement('tr'), th=document.createElement('th'),td=document.createElement('td');
    th.textContent=name;td.textContent=String(value??'—');row.append(th,td);target.append(row);
  }
}
function create():void {
  runtime=new BrowserRuntime();disposed=false;
  runtime.onError=log;
  runtime.onObservation=o=>{
    latest=o;disposed=o.disposed;
    queueView(o,runtime,log);
    const s=o.snapshot;
    for(const button of document.querySelectorAll<HTMLButtonElement>('[data-module]')) {
      const kind=button.dataset.module!;
      const supported=kind==='subsong'?s.capabilities.subsongs>0:kind==='loops'?s.capabilities.loop_limit:kind.startsWith('channel-')?s.capabilities.channel_mute:Boolean(s.capabilities[kind as keyof typeof s.capabilities]);
      button.disabled=!supported;button.title=supported?'':'Unavailable from this provider';
    }
    byId('capabilities').textContent=`${s.capabilities.subsongs} subsongs · ${s.capabilities.channels} module channels. Disabled controls are unavailable from this provider.`;
    byId('metadata').textContent=s.metadata?.map(([k,v])=>`${k}: ${v}`).join('\n')??'';
    const p=s.module;
    byId('patterns').textContent=p?`Decoder order ${p.order} / pattern ${p.pattern} / row ${p.row}\n`+Array.from({length:p.rows},(_,r)=>`${(r+p.first_row).toString(16).padStart(2,'0')}  `+p.cells.slice(r*p.channels,(r+1)*p.channels).map(c=>c.map(n=>n.toString(16).padStart(2,'0')).join(' ')).join(' | ')).join('\n'):'';
    table('snapshot',[
      ['source',o.sourceName],['source bytes',o.sourceBytes],
      ['session / generation',`${s.session} / ${s.generation}`],['state',s.state],['requested / output',`${s.requested} / ${s.running}`],
      ['provider',s.provider?`${s.provider.name} · ${s.provider.version}`:null],
      ['audible frames',s.position_frames],['audible seconds',s.sample_rate?(s.position_frames/s.sample_rate).toFixed(3):null],
      ['total frames',s.total_frames],['decoder EOF',s.decoding_eof],['pending operation',s.pending_operation],['error',s.error],
    ]);
    table('decode',[...Object.entries(o.stats),...Object.entries(o.output)]);
  };
}
create();
byId<HTMLInputElement>('profile-name').value=runtime.profile;
byId('switch-profile').onclick=()=>{const profile=byId<HTMLInputElement>('profile-name').value;if(!/^[a-zA-Z0-9_-]{1,64}$/.test(profile)){log('Use 1–64 letters, digits, underscores or hyphens');return;}const url=new URL(location.href);url.searchParams.set('profile',profile);location.assign(url);};
installPwa(log);
function run(p:Promise<unknown>):void {void p.catch(e=>log(String(e)));}
byId('open').onclick=()=>{
  const file=byId<HTMLInputElement>('file').files?.[0];if(!file) {log('Select a media File');return;}
  run((async()=>{if(disposed){await runtime.close();latest=null;create();}await runtime.load(file,byId<HTMLInputElement>('prefer-webcodecs').checked);})());
};
for(const kind of ['play','pause','stop','dispose'] as CommandKind[]) byId(kind).onclick=()=>{
  if(kind==='dispose')for(const job of jobs)job.cancel();run(runtime.command(kind));
};
byId('seek').onclick=()=>run(runtime.command('seek',Number(byId<HTMLInputElement>('seek-seconds').value)));
byId<HTMLInputElement>('volume').oninput=e=>run(runtime.command('volume',Number((e.target as HTMLInputElement).value)));
byId<HTMLInputElement>('mute').onchange=e=>run(runtime.command('mute',Number((e.target as HTMLInputElement).checked)));
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-module]'))button.onclick=()=>{
  const kind=button.dataset.module as CommandKind;
  run(runtime.command(kind,Number(byId<HTMLInputElement>(`${kind.startsWith('channel-')?'channel':kind}-value`).value)));
};
function job(mode:'probe'|'render',sink?:(bytes:ArrayBuffer)=>Promise<void>):FileJob {
  const file=byId<HTMLInputElement>('file').files?.[0];if(!file)throw new Error('Select a media File');
  const job=new FileJob(file,mode,byId<HTMLInputElement>('verify-unknown').checked,sink);
  byId('job-result').textContent=`${mode} running…`;
  void job.result.then(r=>{byId('job-result').textContent=JSON.stringify(r,null,2);},e=>{byId('job-result').textContent=String(e);});
  return job;
}
const jobs=new Set<FileJob>();
function trackJob(j:FileJob):FileJob {jobs.add(j);void j.result.then(()=>jobs.delete(j),()=>jobs.delete(j));return j;}
byId('probe').onclick=()=>{try{trackJob(job('probe'));}catch(e){log(String(e));}};
byId('render').onclick=()=>run((async()=>{
  const picker=(window as unknown as {showSaveFilePicker?: (options:unknown)=>Promise<{createWritable:()=>Promise<{write:(b:ArrayBuffer)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>}>}>}).showSaveFilePicker;
  const writer=picker?await (await picker({suggestedName:'render.f32'})).createWritable():null;
  try {await trackJob(job('render',writer?b=>writer.write(b):undefined)).result;await writer?.close();}
  catch(e){await writer?.abort();throw e;}
})());
byId('cancel-jobs').onclick=()=>{for(const j of jobs)j.cancel();};
// Explicit diagnostics surface for headless integration and lifecycle checks.
// It exposes commands and observations, never decoder instances or live PCM.
Object.assign(window,{libzci:{load:(file:File)=>runtime.load(file),command:(kind:CommandKind,value?:number)=>runtime.command(kind,value),
  snapshot:()=>latest,suspend:()=>runtime.suspend(),resume:()=>runtime.resume(),
  queue:(command:import('./profile-types.js').QueueCommand)=>runtime.queue(command),
  ingest:(files:File[],handles:import('./profile-types.js').RealFileHandle[]=[],open=true)=>runtime.ingest(files,handles,open),
  job:(mode:'probe'|'render',verify=false)=>runtime.startJob(mode,verify).result,cancelJobs:()=>runtime.cancelJobs()}});
