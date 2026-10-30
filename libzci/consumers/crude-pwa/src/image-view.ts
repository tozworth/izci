import {WebImageSession} from './generated/libzci_web.js';
import {initializeControl} from './control-wasm.js';
import type {BrowserRuntime} from './browser-runtime.js';
import type {CatalogQuery,CatalogRow} from './catalog-types.js';
import type {ImageViewSnapshot} from './image-job.js';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
/** Presentation and job wiring over a document-owned shared-core image session. */
export class ImageView {
  private core:WebImageSession|null=null;
  private epoch=0;private url='';private scope=crypto.randomUUID();
  constructor(private runtime:BrowserRuntime,private log:(s:string)=>void){
    for(const command of ['previous','next','first','last','refresh'])el(`image-${command}`).onclick=()=>{void this.navigate(command).catch(e=>this.log(String(e)));};
    el('image-close').onclick=()=>this.close();
    el('image-edge').onchange=()=>{if(this.core&&this.snapshot()?.media!==null)void this.navigate('refresh').catch(e=>this.log(String(e)));};
    this.controls();
  }
  snapshot():ImageViewSnapshot|null{return this.core?JSON.parse(this.core.snapshot()):null;}
  async open(row:CatalogRow,query:CatalogQuery):Promise<void>{
    const epoch=++this.epoch;this.core?.close();this.clear();this.controls();el('image-caption').textContent='Opening image…';
    try{
      const [sequence]=await Promise.all([this.runtime.imageSequence(query),initializeControl()]);if(epoch!==this.epoch)return;
      this.core??=new WebImageSession();this.core.open(JSON.stringify(sequence),row.id);await this.load();
    }catch(e){if(epoch!==this.epoch)return;el('image-caption').textContent=String(e);throw e;}
  }
  async navigate(kind:string):Promise<void>{
    if(!this.core)return;const before=this.snapshot()!;this.core.navigate(JSON.stringify({kind}),el<HTMLInputElement>('image-wrap').checked);
    if(before.generation!==this.snapshot()!.generation)await this.load();
  }
  private clear():void{
    const image=el<HTMLImageElement>('image-stage');image.removeAttribute('src');image.hidden=true;
    if(this.url){URL.revokeObjectURL(this.url);this.url='';}
    void this.runtime.catalogCancelRenditions(this.scope).catch(()=>{});
  }
  private controls():void{
    const s=this.snapshot();for(const name of ['previous','next','first','last','refresh'])el<HTMLButtonElement>(`image-${name}`).disabled=!s?.count;
  }
  private async load():Promise<void>{
    const s=this.snapshot();if(!s?.media)return;const core=this.core!,epoch=++this.epoch;this.clear();this.controls();
    el('image-caption').textContent=`${s.index!+1} / ${s.count} · Loading…`;
    try{
      const result=await this.runtime.imageRendition(s.media,Number(el<HTMLInputElement>('image-edge').value),this.scope);
      if(epoch!==this.epoch||this.core!==core)return;
      if(!result.facts||!result.rendition)throw new Error('Image rendition unavailable');
      if(!core.complete(s.session,s.generation,s.media,JSON.stringify(result.facts)))return;
      this.url=URL.createObjectURL(new Blob([result.png],{type:'image/png'}));const image=el<HTMLImageElement>('image-stage');image.src=this.url;image.hidden=false;
      el('image-caption').textContent=`${s.index!+1} / ${s.count} · ${result.displayPath??s.media} · ${result.facts.display_width} × ${result.facts.display_height}`;
    }catch(e){if(epoch!==this.epoch)return;el('image-caption').textContent=String(e);throw e;}
  }
  close():void{this.epoch++;this.core?.close();this.clear();el('image-caption').textContent='';this.controls();}
  destroy():void{this.close();this.core?.free();this.core=null;}
}
