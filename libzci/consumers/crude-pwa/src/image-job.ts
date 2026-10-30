export interface ImageFacts {mime:string;width:number;height:number;display_width:number;display_height:number;orientation:number;bits_per_pixel:number;alpha:boolean;icc_bytes:number;icc_sha256:string|null}
export interface ImageSequence {revision:number;media:number[]}
export interface ImageViewSnapshot {session:number;generation:number;origin_revision:number|null;media:number|null;index:number|null;count:number;facts:ImageFacts|null}
export interface CachedRendition {spec:{max_edge:number};source:ImageFacts;width:number;height:number;bytes:number;sha256:string}
export type ImageJobRequest={kind:'inspect'}|{kind:'image'|'artwork';spec:{max_edge:number}}|{kind:'cached';metadata:CachedRendition;spec:{max_edge:number}};
export interface ImageJobResult {facts:ImageFacts|null;rendition:{width:number;height:number;mime:'image/png';bytes:number}|null;metadata:CachedRendition|null;png:Uint8Array;displayPath?:string;cache?:'hit'|'miss'|'unavailable'}
/** Independent visual worker. Rust owns parsing, limits and rendition policy. */
export class ImageJob {
  readonly result:Promise<ImageJobResult>;
  private worker=new Worker(new URL('./workers/image-worker.ts',import.meta.url),{type:'module'});
  private finish:(error?:unknown,result?:ImageJobResult)=>void=()=>{};
  constructor(file:File,request:ImageJobRequest){
    this.result=new Promise((resolve,reject)=>{
      let done=false;this.finish=(error,result)=>{if(done)return;done=true;this.worker.terminate();if(error)reject(error);else resolve(result!);};
      this.worker.onerror=e=>this.finish(new Error(e.message));
      this.worker.onmessage=e=>{if(e.data.error)this.finish(Object.assign(new Error(e.data.error.detail),{kind:e.data.error.kind}));else this.finish(undefined,e.data.result);};
      this.worker.postMessage({file,request});
    });
  }
  cancel():void {this.finish(Object.assign(new Error('Image job cancelled'),{kind:'cancelled'}));}
}
