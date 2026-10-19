import workletUrl from './workers/output-worklet.ts?worker&url';
import audioWasm from './generated/libzci_audio_web.wasm?url';
import type { CommandKind, Snapshot } from './protocol.js';

export interface Observation {snapshot:Snapshot; stats:Record<string,number>; output:Record<string,number>; disposed:boolean}
/** Document adapter: activation/AudioContext/MediaSession and worker assembly.
 * No PCM traverses the document. Closing presentation does not drive transport. */
export class BrowserRuntime {
  private engine = new Worker(new URL('./workers/engine-worker.ts',import.meta.url),{type:'module'});
  private context:AudioContext | null = null;
  private node:AudioWorkletNode | null = null;
  private setup:Promise<void> | null = null;
  private module:Promise<WebAssembly.Module> = fetch(audioWasm).then(r => {
    if (!r.ok) throw new Error(`audio WASM HTTP ${r.status}`);
    return WebAssembly.compileStreaming(r);
  });
  private observation:Observation | null = null;
  onObservation:(o:Observation)=>void=()=>{};
  onError:(message:string)=>void=()=>{};
  constructor() {
    this.engine.onmessage = e => {
      if (e.data.type==='snapshot') {
        this.observation=e.data; this.onObservation(e.data); this.media(e.data.snapshot);
        this.engine.postMessage({type:'ack'});
      } else if(e.data.type==='error') this.onError(`${e.data.kind}: ${e.data.detail}`);
    };
    this.engine.onerror = e => this.onError(e.message);
    if ('mediaSession' in navigator) {
      for (const [action,kind] of [['play','play'],['pause','pause'],['stop','stop']] as const) {
        navigator.mediaSession.setActionHandler(action,()=>void this.command(kind).catch(e=>this.onError(String(e))));
      }
      navigator.mediaSession.setActionHandler('seekto',e=>void this.command('seek',e.seekTime??0));
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
      await resumed;
      await this.context!.audioWorklet.addModule(workletUrl);
      const module=await this.module;
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
  async load(file:File):Promise<void> {
    await this.ensureOutput();
    if(this.observation?.disposed) throw new Error('Create a new runtime after Dispose');
    if('mediaSession' in navigator) navigator.mediaSession.metadata=new MediaMetadata({title:file.name,artist:'libzci reference player'});
    this.engine.postMessage({type:'load',file});
  }
  async command(kind:CommandKind,value=0):Promise<void> {
    if(kind==='play') {
      const output=this.ensureOutput();
      const resumed=this.context!.resume();
      await output;await resumed;
    } else await this.ensureOutput();
    this.engine.postMessage({type:'command',kind,value});
  }
  private media(s:Snapshot):void {
    if(!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState=s.requested==='Running'?'playing':'paused';
    if(s.total_frames && s.sample_rate) navigator.mediaSession.setPositionState({duration:s.total_frames/s.sample_rate,position:Math.min(s.position_frames,s.total_frames)/s.sample_rate,playbackRate:1});
  }
  /** Debug lifecycle operations exercise the real AudioContext, not a fake sink. */
  async suspend():Promise<void> {await this.context?.suspend();}
  async resume():Promise<void> {await this.context?.resume();}
  async close():Promise<void> {
    if(this.context?.state!=='closed') await this.context?.close();
    this.node?.disconnect();this.engine.terminate();
  }
}
