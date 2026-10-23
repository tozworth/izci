import {LocalRuntime,type Observation} from './runtime.js';
import {Capabilities} from './capabilities.js';
import type {CommandKind} from './protocol.js';
import type {QueueCommand,RealFileHandle} from './profile-types.js';
/** One profile lock encloses the SQL worker, decoder, output and Media Session.
 * Attached documents send bounded idempotent requests and acknowledge snapshots. */
export class BrowserRuntime {
  private connect!:()=>void;
  private failConnect!:(e:unknown)=>void;
  private connected=new Promise<void>((resolve,reject)=>{this.connect=resolve;this.failConnect=reject;});
  private id=crypto.randomUUID();
  private term='';
  private channel:BroadcastChannel;
  private local:LocalRuntime|null=null;
  private release:(()=>void)|null=null;
  private closed=false;
  private acquiring=false;
  private heartbeat=Date.now();
  private timer:ReturnType<typeof setInterval>;
  private latest:Observation|null=null;
  private sequence=0;
  private clients=new Map<string,{pending:boolean;sequence:number;seen:number}>();
  private results=new Map<string,Promise<{value?:unknown;error?:string}>>();
  private completed=new Set<string>();
  private inFlight=0;
  private pending=new Map<string,{message:Record<string,unknown>;resolve:(v:any)=>void;reject:(e:unknown)=>void;started:number}>();
  onObservation:(o:Observation)=>void=()=>{};
  onError:(message:string)=>void=()=>{};
  constructor(readonly profile=new URL(location.href).searchParams.get('profile')??'default') {
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(profile))throw new Error('Invalid profile name');
    if(!navigator.locks||!globalThis.BroadcastChannel)throw new Error('Durable profiles require Web Locks and BroadcastChannel');
    this.channel=new BroadcastChannel(`libzci-crude-v1-${profile}`);this.channel.onmessage=e=>void this.receive(e.data);
    void this.connected.catch(()=>{});
    this.timer=setInterval(()=>{
      if(this.local){this.channel.postMessage({type:'owner',term:this.term});for(const [id,c] of this.clients)if(Date.now()-c.seen>30000)this.clients.delete(id);}
      else {this.channel.postMessage({type:'hello',from:this.id});if(Date.now()-this.heartbeat>3500){if(this.latest)this.onObservation({...this.latest,ownership:'owner lost; reopening paused'});void this.acquire();}}
      for(const [id,p] of this.pending) {if(Date.now()-p.started>30000){p.reject(new Error('Owner unavailable; reconnect and inspect the saved revision'));this.pending.delete(id);}else this.channel.postMessage(p.message);}
    },1000);
    this.channel.postMessage({type:'hello',from:this.id});void this.acquire();
    addEventListener('pagehide',()=>void this.close(),{once:true});
  }
  private async acquire():Promise<void> {
    if(this.acquiring||this.local||this.closed)return;this.acquiring=true;
    try {await navigator.locks.request(`libzci-crude-profile-v1-${this.profile}`,{ifAvailable:true},async lock=>{
      this.acquiring=false;if(!lock||this.closed)return;
      this.term=crypto.randomUUID();this.local=new LocalRuntime(this.profile);
      this.local.onError=e=>{if(!this.latest?.profile)this.failConnect(new Error(e));this.onError(e);this.channel.postMessage({type:'error',term:this.term,error:e});};
      this.local.onObservation=o=>{this.latest={...o,ownership:'owner'};if(o.profile)this.connect();this.sequence++;this.onObservation(this.latest);for(const id of this.clients.keys())this.sendSnapshot(id);};
      for(const [id,p] of this.pending) {
        this.pending.delete(id);const m=p.message;
        void this.execute(m.action as string,m.args as unknown[],`${m.revision??0}:${this.id}/${id}`).then(p.resolve,p.reject);
      }
      this.channel.postMessage({type:'owner',term:this.term});
      await new Promise<void>(resolve=>this.release=resolve);
    });}catch(e){this.acquiring=false;this.onError(String(e));}
  }
  private sendSnapshot(id:string):void {
    const client=this.clients.get(id);if(!client||client.pending||client.sequence===this.sequence||!this.latest)return;
    client.pending=true;client.sequence=this.sequence;
    this.channel.postMessage({type:'snapshot',to:id,term:this.term,sequence:this.sequence,observation:{...this.latest,ownership:'attached'}});
  }
  private async receive(m:any):Promise<void> {
    if(!m||typeof m.type!=='string')return;
    if(m.type==='owner'&&!this.local){this.heartbeat=Date.now();if(this.term!==m.term){this.term=m.term;this.channel.postMessage({type:'hello',from:this.id});}}
    if(this.local&&m.type==='hello'&&typeof m.from==='string') {
      this.channel.postMessage({type:'owner',term:this.term});
      if(!this.clients.has(m.from)&&this.clients.size<16)this.clients.set(m.from,{pending:false,sequence:-1,seen:Date.now()});
      const c=this.clients.get(m.from);if(c)c.seen=Date.now();this.sendSnapshot(m.from);
    }
    if(m.type==='snapshot'&&m.to===this.id&&!this.local&&m.term===this.term){this.latest=m.observation;if(this.latest?.profile)this.connect();this.onObservation(m.observation);this.channel.postMessage({type:'ack',from:this.id,sequence:m.sequence});}
    if(m.type==='ack'&&this.local){const c=this.clients.get(m.from);if(c&&c.sequence===m.sequence){c.pending=false;c.seen=Date.now();this.sendSnapshot(m.from);}}
    if(m.type==='error'&&!this.local&&m.term===this.term){if(!this.latest?.profile)this.failConnect(new Error(m.error));this.onError(m.error);}
    if(m.type==='request'&&this.local&&typeof m.id==='string'&&m.id.length<=128&&typeof m.from==='string'&&m.from.length<=128&&Array.isArray(m.args)) {
      const key=`${Number.isSafeInteger(m.revision)?m.revision:0}:${m.from}/${m.id}`;
      let result=this.results.get(key);
      if(!result){
        if(this.inFlight>=32){this.channel.postMessage({type:'result',to:m.from,id:m.id,error:'Owner request budget exhausted'});return;}
        if(this.results.size>=64){const old=this.completed.values().next().value!;this.results.delete(old);this.completed.delete(old);}
        this.inFlight++;result=this.execute(m.action,m.args,key).then(value=>({value}),e=>({error:String(e)})).finally(()=>{this.inFlight--;this.completed.add(key);});this.results.set(key,result);
      }
      this.channel.postMessage({type:'result',to:m.from,id:m.id,...await result});
    }
    if(m.type==='result'&&m.to===this.id){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);if(m.error)p.reject(new Error(m.error));else p.resolve(m.value);}}
  }
  private async execute(action:string,args:any[],request?:string):Promise<unknown> {
    const r=this.local;if(!r)throw new Error('No owner');
    switch(action){case 'load':return r.load(args[0],args[1],request);case 'ingest':return r.ingest(args[0],args[1],args[2],request);case 'command':return r.command(args[0],args[1],request);case 'queue':return r.queue(args[0],request);case 'restore':return r.restore();case 'suspend':return r.suspend();case 'resume':return r.resume();case 'job':return r.startJob(args[0],args[1]).result;case 'cancelJobs':return r.cancelJobs();default:throw new Error('Unknown owner request');}
  }
  private async request(action:string,args:unknown[]=[]):Promise<any> {
    await this.connected;
    if(this.closed)throw new Error('Runtime closed');
    if(this.local)return this.execute(action,args);
    if(this.pending.size>=32)throw new Error('Owner request budget exhausted');
    const id=crypto.randomUUID(),message={type:'request',from:this.id,id,action,args,revision:this.latest?.profile?.revision??0};
    return new Promise((resolve,reject)=>{this.pending.set(id,{message,resolve,reject,started:Date.now()});this.channel.postMessage(message);});
  }
  load(file:File,prefer=false):Promise<void> {return this.request('load',[file,prefer]);}
  ingest(files:File[],handles:RealFileHandle[]=[],open=true):Promise<void> {return this.request('ingest',[files,handles,open]);}
  command(kind:CommandKind,value=0):Promise<void> {return this.request('command',[kind,value]);}
  queue(command:QueueCommand):Promise<void> {return this.request('queue',[command]);}
  async grant():Promise<void> {
    const s=this.latest?.profile;const occurrence=s?.queue.items.find(i=>i.id===s.queue.current);const source=s?.sources.find(r=>r.key===occurrence?.source_key);
    if(!source||source.kind!=='browser_handle')throw new Error('Current source has no restorable handle');
    await new Capabilities(this.profile).grant(source.locator);await this.request('restore');
  }
  startJob(mode:'probe'|'render',verify=false):{result:Promise<any>;cancel:()=>void} {return {result:this.request('job',[mode,verify]),cancel:()=>this.cancelJobs()};}
  cancelJobs():void {void this.request('cancelJobs').catch(e=>this.onError(String(e)));}
  suspend():Promise<void> {return this.request('suspend');}
  resume():Promise<void> {return this.request('resume');}
  async close():Promise<void> {if(this.closed)return;this.closed=true;this.connect();clearInterval(this.timer);await this.local?.close();this.release?.();this.local=null;this.channel.close();for(const p of this.pending.values())p.reject(new Error('Runtime closed'));this.pending.clear();}
}
