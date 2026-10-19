import type {Facts} from './workers/browser-providers.js';
export interface JobResult {facts:Facts;frames:number;peak:number;stats:Record<string,number>}
/** Independent worker/codec context, no AudioContext. Render chunks go directly
 * to the optional export sink; only aggregate observations enter UI state. */
export class FileJob {
  readonly result:Promise<JobResult>;
  private worker=new Worker(new URL('./workers/decode-worker.ts',import.meta.url),{type:'module'});
  private channel=new MessageChannel();
  private finish:(error?:unknown)=>void=()=>{};
  constructor(file:File,mode:'probe'|'render',verifyUnknown=false,sink?:(bytes:ArrayBuffer)=>Promise<void>) {
    this.result=new Promise((resolve,reject)=>{
      let facts:Facts,frames=0,peak=0,stats={},chain=Promise.resolve(),done=false;
      this.finish=(error?:unknown)=>{
        if(done)return;done=true;this.worker.terminate();this.channel.port1.close();
        if(error)reject(error);else resolve({facts,frames,peak,stats});
      };
      this.worker.onerror=e=>this.finish(new Error(e.message));
      this.worker.onmessage=e=>{
        const m=e.data;
        if(m.type==='ready')this.worker.postMessage({type:'open',tag:{session:1,instance:1,operation:1,generation:1},file,mode,verifyUnknown});
        if(m.type==='opened')facts=m.facts;
        if(m.stats)stats=m.stats;
        if(m.type==='progress')this.worker.postMessage({type:'stats-ack'});
        if(m.type==='probe-complete'){facts=m.facts;this.finish();}
        if(m.type==='failed')this.finish(new Error(`${m.kind}: ${m.detail}`));
      };
      this.channel.port1.onmessage=e=>{
        const m=e.data;
        if(m.type==='eof'){void chain.then(()=>this.finish(),this.finish);return;}
        if(m.type!=='block')return;
        chain=chain.then(async()=>{
          const pcm=new Float32Array(m.pcm,0,m.descriptor.frames*2);
          for(const sample of pcm)peak=Math.max(peak,Math.abs(sample));frames+=m.descriptor.frames;
          if(sink)await sink(m.pcm.slice(0,pcm.byteLength));
          if(!done)this.channel.port1.postMessage({type:'recycle',id:m.id,pcm:m.pcm},[m.pcm]);
        }).catch(error=>this.finish(error));
      };
      this.worker.postMessage({type:'init',rate:48000,output:this.channel.port2},[this.channel.port2]);
    });
  }
  cancel():void {this.finish(new Error('cancelled: independent job cancelled'));}
}
