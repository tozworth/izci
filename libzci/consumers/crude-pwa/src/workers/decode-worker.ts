/// <reference lib="webworker" />
import init, { WebPreparation, classify, known_extension } from '../generated/libzci_web.js';
import { openProvider, type Backend, type Facts } from './browser-providers.js';
import { openWebCodecs } from './webcodecs-opus.js';
import createCodec from '../generated/opus-reference.js';
import codecWasm from '../generated/opus-reference.wasm?url';
import { BLOCK_FRAMES, POOL_SIZE, failure, sameTag, type DecodeJob, type Tag } from '../protocol.js';

let output: MessagePort;
let codec: any;
let rate = 48000;
let latest: DecodeJob | null = null;
let active: {tag: Tag; cancelled: boolean} | null = null;
let running = false;
let handle = 0;
let handleInstance = 0;
let backend:Backend|null=null;
let facts:Facts|null=null;
let requestedFile: File | null = null;
let wantClose = false;
let source: {file: File; id: number; error: unknown; reads: number} | null = null;
let nextSource = 1;
let preparation: WebPreparation | null = null;
let sourceEof = false;
let eofSent = false;
const free = new Map<number, ArrayBuffer>();
const reader = new FileReaderSync();
let bytesRead = 0, maxRead = 0, callbackYields = 0, decodedFrames = 0, poolHighWater = 0;
let peak = 0, sumSquares = 0, sampleCount = 0;
let statsPending = false;
let decodedBlocks = 0;
let probing=false;
let requireAnchor=false,awaitingAnchor=false;
let rustHeapBytes=()=>0;
// Task yielding must not depend on background timer budgets. There is one
// sequential C job, so a single reusable task channel/continuation suffices.
const tasks = new MessageChannel();
let continuation: (() => void) | null = null;
tasks.port1.onmessage = () => {const resume = continuation; continuation = null; resume?.();};
const yieldTask = (): Promise<void> => new Promise(resolve => {
  if (continuation) throw new Error('reentrant decoder task');
  continuation = resolve; tasks.port2.postMessage(null);
});
const post = (message: unknown): void => self.postMessage(message);
function check():void {if(active?.cancelled)throw {kind:'cancelled',detail:'operation superseded'};}
function readBytes(position:number,length:number):Uint8Array {
  check();if(!source)throw {kind:'source-access',detail:'File unavailable'};
  try {const data=new Uint8Array(reader.readAsArrayBuffer(source.file.slice(position,position+length)));
    bytesRead+=data.byteLength;maxRead=Math.max(maxRead,data.byteLength);return data;
  }catch(e){throw {kind:'source-access',detail:String(e)};}
}
Object.assign(globalThis,{libzciRead:(id:number,position:number,length:number)=>{
  if(id!==source?.id)throw new Error('stale File identity');return readBytes(position,length);
}});
const position=():number=>backend?.position()??(handle?codec._zci_position(handle):0);
const total=():number|null=>facts?facts.total:handle?codec._zci_total(handle):null;
function currentFacts():Facts {
  if(backend)return backend.facts();
  return {provider:{id:'org.xiph.opus',name:'Reference Opus (libopusfile)',version:'libopusfile-0.12/libopus-1.5.2/r4'},rate:48000,channels:2,total:codec._zci_total(handle),comments:[],capabilities:{subsongs:0,channels:0},module:null,
    applied:{trimmed_preskip:true,trimmed_end:true,applied_header_gain:true}};
}

// This callback is awaited by Asyncify. It never calls back into the C module.
// All C entry points are serialized by drive(); cancellation only changes flags.
async function readSource(id: number, position: number, pointer: number, length: number): Promise<number> {
  const s = source;
  try {
    if (!s || s.id !== id || active?.cancelled) throw {kind: 'cancelled', detail: 'source invalidated'};
    if (++s.reads % 16 === 0) { callbackYields++; await yieldTask(); }
    if (active?.cancelled) throw {kind: 'cancelled', detail: 'source invalidated'};
    if (length < 0 || length > 32768) throw {kind: 'resource-exhausted', detail: 'C read exceeded 32 KiB'};
    const data = reader.readAsArrayBuffer(s.file.slice(position, position + length));
    codec.HEAPU8.set(new Uint8Array(data), pointer);
    bytesRead += data.byteLength; maxRead = Math.max(maxRead, data.byteLength);
    return data.byteLength;
  } catch (e) {
    if (s) s.error = (e as {kind?:string})?.kind ? e : {kind:'source-access',detail:String(e)};
    return -1;
  }
}
function stats(): Record<string, number> {
  return {bytesRead, maxRead, callbackYields, decodedFrames, poolHighWater,
    decodedPosition: position(),
    poolBytes: POOL_SIZE * BLOCK_FRAMES * 2 * 4, freeBlocks: free.size,
    preparationBytes: preparation?.retained_bytes() ?? 0, codecHeapBytes: codec.HEAPU8.byteLength,
    providerHeapBytes:backend?.retainedBytes?.()??0,rustHeapBytes:rustHeapBytes(),
    peak, sumSquares, sampleCount};
}
async function call(name: string, args: number[]): Promise<number> {
  if (source) source.error = null;
  const result = await codec.ccall(name, 'number', args.map(() => 'number'), args, {async: true});
  if (source?.error) throw source.error;
  if (active?.cancelled) throw {kind: 'cancelled', detail: 'operation superseded'};
  if (result < 0) throw {kind: result === -130 ? 'unsupported' : 'decoder-failure', detail: `${name}: opusfile ${result}`};
  return result;
}
function close(): void {
  if (handle) codec._zci_close(handle);
  backend?.close();backend=null;facts=null;
  handle = 0; handleInstance = 0; source = null; preparation?.free(); preparation = null;
}
async function perform(job: DecodeJob): Promise<void> {
  active = {tag: job.tag, cancelled: false};
  awaitingAnchor=requireAnchor;
  sourceEof = false; eofSent = false;
  decodedFrames=peak=sumSquares=sampleCount=0;
  const didOpen = job.type === 'open' || (!handle&&!backend) || handleInstance !== job.tag.instance;
  if (didOpen) {
    close();
    const file = job.file ?? requestedFile;
    if (!file || file.size > 1073741824) throw {kind: 'resource-exhausted', detail: 'File exceeds 1 GiB'};
    source = {file, id: nextSource++, error: null, reads: 0};
    bytesRead = maxRead = callbackYields = 0;
    const hint=file.name.split('.').pop()?.toLowerCase()??'';
    if(job.mode==='probe'&&!known_extension(hint)&&!job.verifyUnknown)throw {kind:'unsupported',detail:'Unknown-extension verification is disabled'};
    let kind=classify(readBytes(0,8192),hint);
    if(kind==='unsupported'&&job.mode==='probe'&&job.verifyUnknown)kind='module';
    if(kind==='unsupported')throw {kind:'unsupported',detail:'No provider claimed this File'};
    if(kind==='opus') {
      handle = codec._zci_create(source.id, file.size);
      if (!handle) throw {kind: 'resource-exhausted', detail: 'codec context allocation failed'};
      await call('zci_open', [handle]);
      if(job.preferWebCodecs&&codec._zci_links(handle)===1) {
        try {backend=await openWebCodecs(source.id,file,codec._zci_total(handle),yieldTask,check);}
        catch(e){check();post({type:'capability',detail:`Optional WebCodecs declined; using reference: ${failure(e).detail}`});}
      }
    } else backend=await openProvider(kind,source.id,file,readBytes,yieldTask,check);
    facts=currentFacts();
    if(job.type==='open') {
      if(job.subsong!=null) {if(!backend)throw {kind:'unsupported',detail:'Subsong unavailable'};await backend.control('subsong',job.subsong);}
      if(job.start_seconds) {const target=Math.min(total()??Infinity,Math.round(job.start_seconds*facts.rate));if(backend)await backend.seek(target);else await call('zci_seek',[handle,target]);}
      facts=currentFacts();
    }
    handleInstance = job.tag.instance;
    const duration=total();
    if (duration!==null&&duration<0) throw {kind: 'decoder-failure', detail: 'invalid reference duration'};
    if (job.type === 'open') post({type: 'opened', tag: job.tag, total:total(), position:position(), facts, stats: stats()});
    if(job.mode==='probe') {probing=true;post({type:'probe-complete',facts,stats:stats()});close();active=null;return;}
  }
  if(job.type==='module') {
    if(!backend||!job.control)throw {kind:'unsupported',detail:'Module controls unavailable'};
    await backend.control(job.control.kind,job.control.value);facts=currentFacts();
  }
  if (job.type === 'seek'||job.type==='module') {
    if (!handle&&!backend) throw {kind: 'cancelled', detail: 'source not opened'};
    const requested=job.control?.kind==='subsong'?0:(job.frame ?? 0);
    const target = Math.min(total()??requested,requested);
    if(backend)await backend.seek(target);else await call('zci_seek', [handle, target]);
    facts=currentFacts();
    post({type: didOpen||job.type==='module' ? 'opened' : 'landed', tag: job.tag, total:total(), position:position(), facts, stats: stats()});
  }
  preparation?.free(); preparation = WebPreparation.for_layout(facts!.rate,facts!.channels,rate,job.tag.generation);
}
async function drive(): Promise<void> {
  if (running || !codec || !output) return;
  running = true;
  try {
    for (;;) {
      if (latest) {
        const job = latest; latest = null;
        try { await perform(job); }
        catch (error) {
          if (!active?.cancelled) post({type: 'failed', tag: job.tag, ...failure(error), stats: stats()});
          // A cancelled open has no reusable handle. Preserve an established
          // decoder across seek cancellation; the next seek repositions it.
          if (job.type === 'open' || handleInstance === 0) close();
          if (!latest) break;
          continue;
        }
      }
      if (awaitingAnchor||probing||!active || active.cancelled || !preparation || eofSent || free.size === 0) break;
      const job = active;
      if (preparation.needs_input() && !sourceEof) {
        const pointer = backend?0:codec._malloc(BLOCK_FRAMES * 2 * 4);
        if (!backend&&!pointer) throw {kind: 'resource-exhausted', detail: 'decode buffer allocation failed'};
        try {
          const start = position();
          const decoded=backend?await backend.read():null;
          const frames = decoded?decoded.length/facts!.channels:await call('zci_read', [handle, pointer, BLOCK_FRAMES * 2]);
          if (job !== active || job.cancelled) continue;
          if (frames === 0) { sourceEof = true; preparation.finish(); }
          else {
            const samples = decoded??codec.HEAPF32.subarray(pointer / 4, pointer / 4 + frames * 2) as Float32Array;
            for (const n of samples) { peak = Math.max(peak, Math.abs(n)); sumSquares += n*n; }
            sampleCount += samples.length; decodedFrames += frames;
            preparation.accept(start, samples);
          }
        } finally { if(pointer)codec._free(pointer); }
      }
      if (job.cancelled) continue;
      const samples = preparation.pull();
      if (samples.length) {
        const [id, buffer] = free.entries().next().value!; free.delete(id);
        new Float32Array(buffer).set(samples);
        output.postMessage({type: 'block', id, pcm: buffer, descriptor: JSON.parse(preparation.descriptor())}, [buffer]);
        poolHighWater = Math.max(poolHighWater, POOL_SIZE - free.size);
        if (++decodedBlocks % 16 === 0 && !statsPending) {
          statsPending = true;post({type:'progress',tag:job.tag,stats:stats(),module:backend?.facts().module??null});
        }
      }
      if (preparation.drained()) {
        eofSent = true;
        post({type: 'eof', tag: job.tag, stats: stats()});
        output.postMessage({type: 'eof', generation: job.tag.generation});
      }
      // Yield even on cached reads; posted stop/seek never waits on an entire file.
      await yieldTask();
    }
  } catch (error) {
    if (active && !active.cancelled) post({type: 'failed', tag: active.tag, ...failure(error), stats: stats()});
  } finally {
    running = false;
    if (wantClose) {close(); active = null; requestedFile = null; wantClose = false; post({type:'released'});}
    if (latest) void drive();
  }
}
let initialized: Promise<void> | null = null;
self.onmessage = event => {
  const m = event.data;
  if(m.type==='anchored') {if(active&&sameTag(active.tag,m.tag)){awaitingAnchor=false;void drive();}return;}
  if (m.type === 'stats-ack') {statsPending = false;return;}
  if (m.type === 'invalidate') {if (active) active.cancelled = true;backend?.interrupt?.(); latest = null; return;}
  if (m.type === 'init') {
    initialized = (async () => {
      rate = m.rate; output = m.output;
      requireAnchor=!!m.transport;
      for (let i = 0; i < POOL_SIZE; i++) free.set(i, new ArrayBuffer(BLOCK_FRAMES * 2 * 4));
      output.onmessage = e => {
        const r = e.data;
        if (r.type !== 'recycle') return;
        if (r.id < 0 || r.id >= POOL_SIZE || free.has(r.id) || r.pcm.byteLength !== BLOCK_FRAMES*8) {
          post({type:'failed',tag:active?.tag,kind:'resource-exhausted',detail:'invalid recycled credit'}); return;
        }
        free.set(r.id, r.pcm); void drive();
      };
      const wasm=await init();rustHeapBytes=()=>wasm.memory.buffer.byteLength;
      codec = await createCodec({locateFile: () => new URL(codecWasm,import.meta.url).href, readSource});
      post({type:'ready'}); void drive();
    })();
    initialized.catch(e => post({type:'failed',tag:active?.tag,...failure(e)}));
  } else if (m.type === 'open' || m.type === 'seek' || m.type==='module') {
    if (active) active.cancelled = true;
    backend?.interrupt?.();
    if (m.type === 'open') requestedFile = m.file;
    wantClose = false;
    latest = m;
    probing=false;
    void initialized?.then(drive);
  } else if (m.type === 'cancel' || m.type === 'close') {
    if (active) active.cancelled = true;
    backend?.interrupt?.();
    latest = null;
    // drive's finally runs only after Asyncify has fully rewound. New work
    // supersedes a pending close, so release cannot close a replacement load.
    wantClose = true;
    void initialized?.then(drive);
  }
};
