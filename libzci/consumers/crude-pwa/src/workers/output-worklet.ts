import { BLOCK_FRAMES, POOL_SIZE, type Block } from '../protocol.js';
declare const sampleRate: number;
declare class AudioWorkletProcessor { port: MessagePort; constructor(options?: unknown); }
declare function registerProcessor(name:string, processor: typeof AudioWorkletProcessor): void;

type AudioWasm = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  renderer_new(): number; renderer_free(p:number):void;
  renderer_input(p:number):number; renderer_output(p:number):number;
  renderer_reset(p:number,g:number,position:number):void;
  renderer_settings(p:number,r:number,v:number,m:number,l:number):void;
  renderer_enqueue(p:number,id:number,g:number,start:number,end:number,output:number,rate:number,frames:number):number;
  renderer_eof(p:number,g:number):void; renderer_process(p:number):void;
  renderer_recycled_count(p:number):number; renderer_recycled(p:number,n:number):number;
  renderer_position(p:number):number; renderer_media(p:number):number;
  renderer_silence(p:number):number; renderer_finished(p:number):number;
};
class Output extends AudioWorkletProcessor {
  private wasm: AudioWasm;
  private pointer: number;
  private input: Float32Array;
  private samples: Float32Array;
  private buffers = new Map<number,ArrayBuffer>();
  private decode!: MessagePort;
  private control!: MessagePort;
  private generation = -1;
  private count = 0;
  private reportPending = false;
  private closed = false;
  private reportedFinished = false;
  private highWater = 0;
  private peak = 0;
  private energy = 0;
  private intervalPeak = 0;
  constructor(options: {processorOptions: {module:WebAssembly.Module}}) {
    super();
    this.wasm = new WebAssembly.Instance(options.processorOptions.module, {}).exports as AudioWasm;
    this.pointer = this.wasm.renderer_new();
    this.input = new Float32Array(this.wasm.memory.buffer,this.wasm.renderer_input(this.pointer),BLOCK_FRAMES*2);
    this.samples = new Float32Array(this.wasm.memory.buffer,this.wasm.renderer_output(this.pointer),256);
    this.port.onmessage = e => {
      if (e.data.type !== 'attach') return;
      this.decode = e.data.decode; this.control = e.data.control;
      this.decode.onmessage = event => this.block(event.data);
      this.control.onmessage = event => this.command(event.data);
    };
  }
  private recycle(id:number): void {
    const pcm = this.buffers.get(id);
    if (!pcm) return;
    this.buffers.delete(id);
    this.decode.postMessage({type:'recycle',id,pcm},[pcm]);
  }
  private block(m:Block | {type:'eof';generation:number}): void {
    if (this.closed) {if(m.type==='block') this.decode.postMessage({type:'recycle',id:m.id,pcm:m.pcm},[m.pcm]);return;}
    if (m.type === 'eof') {this.wasm.renderer_eof(this.pointer,m.generation);return;}
    const d = m.descriptor;
    if (m.id<0 || m.id>=POOL_SIZE || this.buffers.has(m.id) || m.pcm.byteLength!==BLOCK_FRAMES*8) {
      this.control.postMessage({type:'failed',detail:'invalid worklet pool credit'});return;
    }
    this.buffers.set(m.id,m.pcm);
    if (d.generation!==this.generation) {this.recycle(m.id);return;}
    if (d.frames<1 || d.frames>BLOCK_FRAMES || d.rate!==sampleRate) {
      this.recycle(m.id);this.control.postMessage({type:'failed',detail:'invalid output block'});return;
    }
    this.input.set(new Float32Array(m.pcm,0,d.frames*2));
    if (!this.wasm.renderer_enqueue(this.pointer,m.id,d.generation,d.source_start,d.source_end,d.output_start,d.rate,d.frames)) {
      this.recycle(m.id);this.control.postMessage({type:'failed',detail:'worklet capacity exceeded'});return;
    }
    this.highWater = Math.max(this.highWater,this.buffers.size);
  }
  private command(m:any): void {
    if (m.type==='report-ack') {this.reportPending=false;return;}
    if (m.type==='close') {
      for (const id of this.buffers.keys()) this.recycle(id);
      this.wasm.renderer_free(this.pointer); this.closed=true; return;
    }
    if (this.closed) return;
    if (m.type==='reset'||m.type==='anchor'&&m.generation===this.generation) {
      this.generation=m.generation;this.reportedFinished=false;
      this.peak=0;this.energy=0;this.intervalPeak=0;this.highWater=0;
      for (const id of this.buffers.keys()) this.recycle(id);
      this.wasm.renderer_reset(this.pointer,m.generation,m.position);
      this.control.postMessage({type:m.type==='anchor'?'anchor-ack':'reset-ack',generation:m.generation});
    } else if (m.type==='settings' && m.generation===this.generation) {
      this.wasm.renderer_settings(this.pointer,Number(m.running),m.volume,Number(m.mute),m.latency);
    }
  }
  process(_inputs:Float32Array[][],outputs:Float32Array[][]): boolean {
    if (this.closed) return false;
    this.wasm.renderer_process(this.pointer);
    const channels=outputs[0]!;
    for(let i=0;i<128;i++) {
      channels[0]![i]=this.samples[i*2]!; channels[1]![i]=this.samples[i*2+1]!;
      const a=Math.abs(this.samples[i*2]!), b=Math.abs(this.samples[i*2+1]!);
      this.peak=Math.max(this.peak,a,b);this.energy+=a*a+b*b;
      this.intervalPeak=Math.max(this.intervalPeak,a,b);
    }
    for(let n=0;n<this.wasm.renderer_recycled_count(this.pointer);n++) this.recycle(this.wasm.renderer_recycled(this.pointer,n));
    const finished=!!this.wasm.renderer_finished(this.pointer);
    if (this.control && !this.reportPending && (++this.count%16===0 || finished && !this.reportedFinished)) {
      this.reportPending=true;this.reportedFinished=finished;
      this.control.postMessage({type:'report',generation:this.generation,position:this.wasm.renderer_position(this.pointer),
        media:this.wasm.renderer_media(this.pointer),silence:this.wasm.renderer_silence(this.pointer),finished,
        queuedBlocks:this.buffers.size,highWater:this.highWater,peak:this.peak,intervalPeak:this.intervalPeak,energy:this.energy,rate:sampleRate,
        audioHeapBytes:this.wasm.memory.buffer.byteLength});
      this.intervalPeak=0;
    }
    return true;
  }
}
registerProcessor('libzci-output',Output);
