import type {Facts} from './workers/browser-providers.js';
/** Sequential reusable probe context. Scans create a bounded number of these;
 * no AudioContext, transport session or UI PCM forwarding is involved. */
export class ProbeWorker {
  private worker=new Worker(new URL('./workers/decode-worker.ts',import.meta.url),{type:'module'});
  private channel=new MessageChannel();
  private initialized:Promise<void>;
  private pending:{resolve:(facts:Facts)=>void;reject:(e:unknown)=>void}|null=null;
  private closed=false;
  private sequence=0;
  private rejectInit:(e:unknown)=>void=()=>{};
  constructor(){
    this.initialized=new Promise((resolve,reject)=>{
      this.rejectInit=reject;
      this.worker.onmessage=e=>{
        const m=e.data;
        if(m.type==='ready')resolve();
        if(m.type==='probe-complete'){const pending=this.pending;this.pending=null;pending?.resolve(m.facts);}
        if(m.type==='failed'){
          const error=Object.assign(new Error(m.detail),{kind:m.kind});
          reject(error);const pending=this.pending;this.pending=null;pending?.reject(error);
        }
        if(m.type==='progress')this.worker.postMessage({type:'stats-ack'});
      };
      this.worker.onerror=e=>{const error=new Error(e.message);reject(error);this.pending?.reject(error);this.pending=null;};
      this.worker.postMessage({type:'init',rate:48000,output:this.channel.port2},[this.channel.port2]);
    });
    void this.initialized.catch(()=>{});
  }
  async inspect(file:File,verifyUnknown:boolean):Promise<Facts>{
    await this.initialized;
    if(this.closed)throw new Error('Probe worker closed');
    if(this.pending)throw new Error('Probe worker already has a job');
    const sequence=++this.sequence;
    return new Promise((resolve,reject)=>{
      this.pending={resolve,reject};
      this.worker.postMessage({type:'open',tag:{session:1,instance:sequence,operation:sequence,generation:sequence},file,mode:'probe',verifyUnknown});
    });
  }
  close():void{
    const error=Object.assign(new Error('Probe cancelled'),{kind:'cancelled'});
    this.closed=true;this.rejectInit(error);this.pending?.reject(error);this.pending=null;
    this.worker.terminate();this.channel.port1.close();
  }
}
