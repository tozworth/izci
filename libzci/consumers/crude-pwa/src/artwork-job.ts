export interface EncodedArtwork {info:{mime:string;picture_type:number;bytes:number};bytes:Uint8Array}
/** Explicit, cancellable source job; encoded originals remain transient. */
export class ArtworkJob {
  readonly result:Promise<EncodedArtwork|null>;
  private worker=new Worker(new URL('./workers/artwork-worker.ts',import.meta.url),{type:'module'});
  private finish:(error?:unknown,artwork?:EncodedArtwork|null)=>void=()=>{};
  constructor(file:File){
    this.result=new Promise((resolve,reject)=>{
      let done=false;this.finish=(error,artwork)=>{if(done)return;done=true;this.worker.terminate();if(error)reject(error);else resolve(artwork??null);};
      this.worker.onerror=e=>this.finish(new Error(e.message));
      this.worker.onmessage=e=>{if(e.data.error)this.finish(Object.assign(new Error(e.data.error.detail),{kind:e.data.error.kind}));else this.finish(undefined,e.data.artwork);};
      this.worker.postMessage({file});
    });
  }
  cancel():void{this.finish(Object.assign(new Error('Artwork job cancelled'),{kind:'cancelled'}));}
}
