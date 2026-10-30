import type {LyricsDocument} from './lyrics-types.js';
/** Cancellable, output-free source job. Raw reads/format policy run in Rust. */
export class LyricsJob {
  readonly result:Promise<LyricsDocument|null>;
  private worker=new Worker(new URL('./workers/lyrics-worker.ts',import.meta.url),{type:'module'});
  private finish:(error?:unknown,document?:LyricsDocument|null)=>void=()=>{};
  constructor(file:File){
    this.result=new Promise((resolve,reject)=>{
      let done=false;this.finish=(error,document)=>{if(done)return;done=true;this.worker.terminate();if(error)reject(error);else resolve(document??null);};
      this.worker.onerror=e=>this.finish(new Error(e.message));
      this.worker.onmessage=e=>{if(e.data.error)this.finish(Object.assign(new Error(e.data.error.detail),{kind:e.data.error.kind}));else this.finish(undefined,e.data.document);};
      this.worker.postMessage({file});
    });
  }
  cancel():void{this.finish(Object.assign(new Error('Lyrics job cancelled'),{kind:'cancelled'}));}
}
