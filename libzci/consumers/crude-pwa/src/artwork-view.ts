import type {BrowserRuntime} from './browser-runtime.js';
import type {CatalogRow} from './catalog-types.js';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
/** One presentation-owned URL; decoding and rendition policy live in Rust. */
export class ArtworkView {
  private epoch=0;
  private url='';
  constructor(private runtime:BrowserRuntime,private log:(message:string)=>void){el('artwork-close').onclick=()=>this.close();}
  close():void {
    this.epoch++;el<HTMLImageElement>('artwork-image').removeAttribute('src');el('artwork-image').hidden=true;el('artwork-caption').textContent='';
    if(this.url){URL.revokeObjectURL(this.url);this.url='';}
    void this.runtime.catalogCancelRenditions().catch(()=>{});
  }
  async open(row:CatalogRow):Promise<void> {
    this.close();const epoch=this.epoch;el('artwork-caption').textContent=`Loading artwork · ${row.metadata.title}`;
    try{
      const result=await this.runtime.catalogRendition(row.id);
      if(epoch!==this.epoch)return;
      if(!result.rendition){el('artwork-caption').textContent='No embedded artwork';return;}
      this.url=URL.createObjectURL(new Blob([result.png],{type:'image/png'}));
      const image=el<HTMLImageElement>('artwork-image');image.src=this.url;image.hidden=false;
      el('artwork-caption').textContent=`${row.metadata.title} · ${result.facts!.display_width} × ${result.facts!.display_height}`;
    }catch(e){if(epoch!==this.epoch)return;el('artwork-caption').textContent='Artwork unavailable';this.log(String(e));}
  }
}
