import workletUrl from './workers/output-worklet.ts?worker&url';
import audioWasm from './generated/libzci_audio_web.wasm?url';
import type { CommandKind, Snapshot } from './protocol.js';
import { FileJob } from './file-job.js';
import type {ProfileState,QueueCommand,RealFileHandle} from './profile-types.js';

export interface Observation {snapshot:Snapshot; stats:Record<string,number>; output:Record<string,number>; disposed:boolean; sourceName?:string; sourceBytes?:number;profile?:ProfileState;access?:string;ownership?:string}
/** Document adapter: activation/AudioContext/MediaSession and worker assembly.
 * No PCM traverses the document. Closing presentation does not drive transport. */
export class LocalRuntime {
  private file:File|null=null;
  private jobs=new Set<FileJob>();
  private engine = new Worker(new URL('./workers/engine-worker.ts',import.meta.url),{type:'module'});
  private context:AudioContext | null = null;
  private node:AudioWorkletNode | null = null;
  private setup:Promise<void> | null = null;
  private observation:Observation | null = null;
  private initialized:Promise<void>;
  private pending=new Map<string,{resolve:()=>void;reject:(e:unknown)=>void}>();
  onObservation:(o:Observation)=>void=()=>{};
  onError:(message:string)=>void=()=>{};
  constructor(profile:string) {
    let resolve!:()=>void,reject!:(e:unknown)=>void;this.initialized=new Promise((yes,no)=>{resolve=yes;reject=no;});
    this.engine.onmessage = e => {
      if (e.data.type==='snapshot') {
        this.observation=e.data; this.onObservation(e.data); this.media(e.data.snapshot);
        this.engine.postMessage({type:'ack'});
      } else if(e.data.type==='source')this.file=e.data.file;
      else if(e.data.type==='profile-ready')resolve();
      else if(e.data.type==='profile-failed')reject(new Error(e.data.error));
      else if(e.data.type==='result') {const pending=this.pending.get(e.data.request);this.pending.delete(e.data.request);if(e.data.error)pending?.reject(new Error(e.data.error));else pending?.resolve();}
      else if(e.data.type==='error') this.onError(`${e.data.kind}: ${e.data.detail}`);
    };
    this.engine.postMessage({type:'profile-init',name:profile});
    void this.initialized.catch(e=>this.onError(String(e)));
    this.engine.onerror = e => {reject(new Error(e.message));for(const p of this.pending.values())p.reject(new Error(e.message));this.pending.clear();this.onError(`Engine worker failed: ${e.message}; reload to reopen paused state`);};
    if ('mediaSession' in navigator) {
      for (const [action,kind] of [['play','play'],['pause','pause'],['stop','stop']] as const) {
        navigator.mediaSession.setActionHandler(action,()=>void this.command(kind).catch(e=>this.onError(String(e))));
      }
      navigator.mediaSession.setActionHandler('seekto',e=>void this.command('seek',e.seekTime??0));
      navigator.mediaSession.setActionHandler('nexttrack',()=>void this.queue({kind:'next',ended:false}).catch(e=>this.onError(String(e))));
      navigator.mediaSession.setActionHandler('previoustrack',()=>void this.queue({kind:'previous',position_seconds:(this.observation?.snapshot.position_frames??0)/(this.observation?.snapshot.sample_rate??1)}).catch(e=>this.onError(String(e))));
    }
  }
  private contextChanged():void {
    if(!this.context) return;
    this.engine.postMessage({type:'context',state:this.context.state,
      latency:(this.context.baseLatency+(this.context.outputLatency??0))*this.context.sampleRate});
  }
  private ensureOutput():Promise<void> {
    if(this.setup) return this.setup;
    // Construct/resume synchronously in the initiating user gesture.
    this.context=new AudioContext({sampleRate:48000,latencyHint:'playback'});
    this.context.onstatechange=()=>this.contextChanged();
    const resumed=this.context.resume();
    this.setup=(async()=>{
      await this.initialized;
      await resumed;
      await this.context!.audioWorklet.addModule(workletUrl);
      const response=await fetch(audioWasm);
      if(!response.ok) throw new Error(`audio WASM HTTP ${response.status}`);
      const module=await WebAssembly.compileStreaming(response);
      this.node=new AudioWorkletNode(this.context!,'libzci-output',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{module}});
      this.node.onprocessorerror=()=>this.engine.postMessage({type:'output-error',detail:'AudioWorklet processor failed'});
      const control=new MessageChannel(), decode=new MessageChannel();
      this.node.port.postMessage({type:'attach',control:control.port1,decode:decode.port1},[control.port1,decode.port1]);
      this.engine.postMessage({type:'attach',control:control.port2,decode:decode.port2,rate:this.context!.sampleRate,
        latency:(this.context!.baseLatency+(this.context!.outputLatency??0))*this.context!.sampleRate},[control.port2,decode.port2]);
      this.node.connect(this.context!.destination);this.contextChanged();
    })();
    return this.setup;
  }
  async load(file:File,preferWebCodecs=false,request?:string):Promise<void> {
    await this.ensureOutput();
    if(this.observation?.disposed) throw new Error('Create a new runtime after Dispose');
    if('mediaSession' in navigator) navigator.mediaSession.metadata=new MediaMetadata({title:file.name,artist:'libzci reference player'});
    await this.request({type:'load',file,preferWebCodecs},request);
    this.file=file;
  }
  private async request(message:Record<string,unknown>,request:string=crypto.randomUUID()):Promise<void> {
    await this.initialized;if(this.pending.size>=32)throw new Error('Too many pending runtime commands');
    await new Promise<void>((resolve,reject)=>{this.pending.set(request,{resolve,reject});this.engine.postMessage({...message,request});});
  }
  async ingest(files:File[],handles:RealFileHandle[]=[],open=true,request?:string):Promise<void> {await this.ensureOutput();await this.request({type:'ingest',files,handles,open},request);this.file=files[0]??this.file;}
  async queue(command:QueueCommand,request?:string):Promise<void> {if(['play','next','previous'].includes(command.kind))await this.ensureOutput();await this.request({type:'queue',command},request);}
  async restore():Promise<void> {await this.ensureOutput();await this.request({type:'restore'});}
  startJob(mode:'probe'|'render',verifyUnknown=false,sink?:(bytes:ArrayBuffer)=>Promise<void>):FileJob {
    if(!this.file)throw new Error('Select a source first');
    const job=new FileJob(this.file,mode,verifyUnknown,sink);this.jobs.add(job);
    void job.result.then(()=>this.jobs.delete(job),()=>this.jobs.delete(job));return job;
  }
  cancelJobs():void {for(const job of this.jobs)job.cancel();this.jobs.clear();}
  async command(kind:CommandKind,value=0,request?:string):Promise<void> {
    if(kind==='dispose')this.cancelJobs();
    if(kind==='play') {
      const output=this.ensureOutput();
      const resumed=this.context!.resume();
      await output;await resumed;
    } else await this.ensureOutput();
    await this.request({type:'command',kind,value},request);
  }
  private media(s:Snapshot):void {
    if(!('mediaSession' in navigator)) return;
    if(this.observation?.sourceName&&navigator.mediaSession.metadata?.title!==this.observation.sourceName)navigator.mediaSession.metadata=new MediaMetadata({title:this.observation.sourceName,artist:'libzci'});
    navigator.mediaSession.playbackState=s.requested==='Running'?'playing':'paused';
    if(s.total_frames && s.sample_rate) navigator.mediaSession.setPositionState({duration:s.total_frames/s.sample_rate,position:Math.min(s.position_frames,s.total_frames)/s.sample_rate,playbackRate:1});
  }
  /** Debug lifecycle operations exercise the real AudioContext, not a fake sink. */
  async suspend():Promise<void> {await this.context?.suspend();}
  async resume():Promise<void> {await this.context?.resume();}
  async close():Promise<void> {
    this.cancelJobs();
    if(this.context?.state!=='closed') await this.context?.close();
    this.node?.disconnect();this.engine.terminate();
    for(const p of this.pending.values())p.reject(new Error('Runtime closed'));this.pending.clear();
  }
}
