import { BrowserRuntime, type Observation } from './runtime.js';
import type {CommandKind} from './protocol.js';
const byId=<T extends HTMLElement>(id:string):T=>document.getElementById(id) as T;
let runtime:BrowserRuntime;
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
    const s=o.snapshot;
    table('snapshot',[
      ['session / generation',`${s.session} / ${s.generation}`],['state',s.state],['requested / output',`${s.requested} / ${s.running}`],
      ['provider',s.provider?`${s.provider.name} · ${s.provider.version}`:null],
      ['audible frames',s.position_frames],['audible seconds',s.sample_rate?(s.position_frames/s.sample_rate).toFixed(3):null],
      ['total frames',s.total_frames],['decoder EOF',s.decoding_eof],['pending operation',s.pending_operation],['error',s.error],
    ]);
    table('decode',[...Object.entries(o.stats),...Object.entries(o.output)]);
  };
}
create();
function run(p:Promise<unknown>):void {void p.catch(e=>log(String(e)));}
byId('open').onclick=()=>{
  const file=byId<HTMLInputElement>('file').files?.[0];if(!file) {log('Select an Opus File');return;}
  if(disposed) {run(runtime.close());create();}
  run(runtime.load(file));
};
for(const kind of ['play','pause','stop','dispose'] as CommandKind[]) byId(kind).onclick=()=>run(runtime.command(kind));
byId('seek').onclick=()=>run(runtime.command('seek',Number(byId<HTMLInputElement>('seek-seconds').value)));
byId<HTMLInputElement>('volume').oninput=e=>run(runtime.command('volume',Number((e.target as HTMLInputElement).value)));
byId<HTMLInputElement>('mute').onchange=e=>run(runtime.command('mute',Number((e.target as HTMLInputElement).checked)));
// Explicit diagnostics surface for headless integration and lifecycle checks.
// It exposes commands and observations, never decoder instances or live PCM.
Object.assign(window,{libzci:{load:(file:File)=>runtime.load(file),command:(kind:CommandKind,value?:number)=>runtime.command(kind,value),
  snapshot:()=>latest,suspend:()=>runtime.suspend(),resume:()=>runtime.resume()}});
