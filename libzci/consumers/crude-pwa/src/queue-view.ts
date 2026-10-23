import type {Observation} from './runtime.js';
import type {BrowserRuntime} from './browser-runtime.js';
import type {QueueCommand,RealFileHandle} from './profile-types.js';
let revision=-1;
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
export function queueView(o:Observation,runtime:BrowserRuntime,log:(s:string)=>void):void {
  const send=(command:QueueCommand)=>void runtime.queue(command).catch(e=>log(String(e)));
  el('profile-status').textContent=`Profile ${runtime.profile} · ${o.ownership??'connecting'} · access ${o.access??'none'} · ${o.profile?.revision??'—'}`;
  if(!o.profile)return;const s=o.profile;
  el('previous').onclick=()=>send({kind:'previous',position_seconds:o.snapshot.position_frames/(o.snapshot.sample_rate??1)});
  el('next').onclick=()=>send({kind:'next',ended:false});
  el('grant').onclick=()=>void runtime.grant().catch(e=>log(String(e)));
  el('open-handle').onclick=()=>{
    const picker=(globalThis as unknown as {showOpenFilePicker?:(o:unknown)=>Promise<RealFileHandle[]>}).showOpenFilePicker;
    if(!picker){log('Restorable File System Access pickers unavailable; plain File input remains usable');return;}
    void (async()=>{const handles=await picker({multiple:true});const files=await Promise.all(handles.map(h=>h.getFile()));await runtime.ingest(files,handles);})().catch(e=>log(String(e)));
  };
  el('append-files').onclick=()=>{const files=Array.from(el<HTMLInputElement>('file').files??[]);void runtime.ingest(files,[],false).catch(e=>log(String(e)));};
  el('clear-up-next').onclick=()=>send({kind:'clear_up_next'});
  const settings=()=>send({kind:'settings',settings:{...s.settings,shuffle:el<HTMLInputElement>('shuffle').checked,repeat:el<HTMLSelectElement>('repeat').value as 'off'|'all'|'one',previous_restart_seconds:Number(el<HTMLInputElement>('restart-threshold').value)}});
  if(revision===s.revision)return;revision=s.revision;
  el<HTMLInputElement>('shuffle').checked=s.settings.shuffle;el<HTMLSelectElement>('repeat').value=s.settings.repeat;el<HTMLInputElement>('restart-threshold').value=String(s.settings.previous_restart_seconds);
  el<HTMLInputElement>('volume').value=String(s.settings.volume);el<HTMLInputElement>('mute').checked=s.settings.mute;
  for(const id of ['shuffle','repeat','restart-threshold'])el(id).onchange=settings;
  el('up-next').textContent=`Up-next: ${s.queue.up_next.join(', ')||'empty'}`;
  const target=el('queue');target.replaceChildren();
  for(const [index,item] of s.queue.items.entries()) {
    const source=s.sources.find(r=>r.key===item.source_key)!;const row=document.createElement('tr');
    const name=document.createElement('td');name.textContent=`${s.queue.current===item.id?'▶ ':''}#${item.id} ${source.display_path} (${source.kind==='browser_handle'?'restorable':'plain File; non-restorable'})`;row.append(name);
    for(const [label,command,disabled] of [
      ['Play',{kind:'play',id:item.id},false],['Up-next',{kind:'up_next',id:item.id},false],
      ['↑',{kind:'move',id:item.id,index:index-1},index===0],['↓',{kind:'move',id:item.id,index:index+1},index+1===s.queue.items.length],['Remove',{kind:'remove',id:item.id},false],
    ] as [string,QueueCommand,boolean][]) {const cell=document.createElement('td'),button=document.createElement('button');button.textContent=label;button.disabled=disabled;button.onclick=()=>send(command);cell.append(button);row.append(cell);}
    target.append(row);
  }
}
