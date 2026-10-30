import init,{WebLyrics} from './generated/libzci_web.js';
import type {BrowserRuntime} from './browser-runtime.js';
import type {CatalogRow} from './catalog-types.js';
import type {Observation} from './runtime.js';
import {failure} from './protocol.js';
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let initialized:Promise<unknown>|null=null;
/** Pure presentation over a transient shared-Rust document. */
export class LyricsView {
  private document:WebLyrics|null=null;
  private source:string|null=null;
  private observation:Observation|null=null;
  private epoch=0;
  private rows:HTMLElement[]=[];
  private active:[number,number]=[-1,-1];
  constructor(private runtime:BrowserRuntime,private log:(s:string)=>void){
    element('lyrics-open').onclick=()=>{const file=element<HTMLInputElement>('lyrics-file').files?.[0];if(!file)return;const epoch=++this.epoch,source=this.current();
      if(file.size>256*1024){this.log('Lyrics exceed 256 KiB');return;}
      void file.text().then(raw=>this.show(raw,source,epoch)).catch(e=>{if(epoch===this.epoch)element('lyrics-status').textContent=failure(e).detail;this.log(failure(e).detail);});
    };
    element('lyrics-cancel').onclick=()=>{++this.epoch;void runtime.catalogCancelLyrics().catch(e=>this.log(String(e)));element('lyrics-status').textContent='Cancelled';};
    element('lyrics-delay').onchange=()=>{if(this.observation)this.observe(this.observation);};
  }
  private current():string|null{
    const o=this.observation;if(!o?.profile||o.disposed||['Idle','Failed','Loading'].includes(o.snapshot.state))return null;
    const item=o.profile.queue.items.find(i=>i.id===o.profile!.queue.current);return item?.source_key??null;
  }
  async open(row:CatalogRow):Promise<void>{
    const epoch=++this.epoch;element('lyrics-status').textContent=`Reading ${row.source.display_path}…`;
    try{
    const document=await this.runtime.catalogLyrics(row.id);if(epoch!==this.epoch)return;
    if(!document){this.document?.free();this.document=null;this.rows=[];element('lyrics-rows').replaceChildren();element('lyrics-status').textContent='No embedded lyrics';return;}
    await this.show(document.raw,row.source.key,epoch);
    }catch(error){if(epoch===this.epoch)element('lyrics-status').textContent=failure(error).detail;throw error;}
  }
  private async show(raw:string,source:string|null,epoch:number):Promise<void>{
    await(initialized??=init());if(epoch!==this.epoch)return;
    const parser=new WebLyrics(raw);this.document?.free();this.document=parser;this.source=source;this.active=[-1,-1];
    const snapshot=JSON.parse(parser.snapshot()) as {plain:string;lines:{time_ms:number;text:string}[]};
    this.rows=snapshot.lines.map(line=>{const row=document.createElement('button');row.textContent=`${(line.time_ms/1000).toFixed(3)}s  ${line.text}`;row.style.cssText='display:block;text-align:left;width:100%;border:0;font:inherit';row.onclick=()=>{
      if(this.source&&this.source===this.current()){const delay=Number(element<HTMLInputElement>('lyrics-delay').value);void this.runtime.command('seek',Math.max(0,line.time_ms/1000+delay)).catch(e=>this.log(String(e)));}
    };return row;});
    const root=element('lyrics-rows');root.replaceChildren(...this.rows);if(!snapshot.lines.length)root.textContent=snapshot.plain;
    element('lyrics-status').textContent=`Loaded transient lyrics · ${snapshot.lines.length} cues`;if(this.observation)this.observe(this.observation);
  }
  observe(observation:Observation):void{
    this.observation=observation;if(!this.document)return;
    const delay=Number(element<HTMLInputElement>('lyrics-delay').value);
    const time=this.source&&this.source===this.current()?observation.snapshot.position_frames/(observation.snapshot.sample_rate??1)-delay:NaN;
    const first=this.document.active_first(time),end=this.document.active_end(time);
    if(first===this.active[0]&&end===this.active[1])return;
    for(let n=this.active[0];n>=0&&n<this.active[1];n++)this.rows[n]?.removeAttribute('aria-current');
    for(let n=first;n>=0&&n<end;n++)this.rows[n]?.setAttribute('aria-current','true');
    this.active=[first,end];
    if(first>=0&&element<HTMLInputElement>('lyrics-follow').checked)this.rows[first]?.scrollIntoView({block:'nearest'});
  }
  close():void{++this.epoch;this.document?.free();this.document=null;void this.runtime.catalogCancelLyrics().catch(()=>{});}
}
