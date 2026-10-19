import init, { WebEngine } from '../generated/libzci_web.js';
import { failure, sameTag, type Snapshot, type Tag } from '../protocol.js';

const decoder = new Worker(new URL('./decode-worker.ts', import.meta.url), {type:'module'});
const ready = init().then(() => new WebEngine());
ready.catch(e => self.postMessage({type:'error',kind:'unavailable',detail:`control WASM initialization: ${String(e)}`}));
let web: WebEngine;
let output: MessagePort;
let file: File | undefined;
let preferWebCodecs=false;
let stats: Record<string, unknown> = {};
let outputStats: Record<string, unknown> = {};
let generation = -1;
let disposed = false;
let contextState = 'suspended';
let latency = 0;
let failedTag: Tag | null = null;
let outstanding = false;
let dirty = true;
let acknowledgedGeneration = -1;
let anchoredGeneration = -1;
let pendingJob: Record<string,unknown> | null = null;
function launch(): void {
  if (pendingJob && acknowledgedGeneration === generation) {
    decoder.postMessage(pendingJob); pendingJob = null;
  }
}

function snapshot(): Snapshot {return JSON.parse(web.snapshot()) as Snapshot;}
function publish(): void {
  dirty = true;
  // One UI update in flight: a stalled document never grows a message queue.
  if (outstanding) return;
  outstanding = true; dirty = false;
  self.postMessage({type:'snapshot',snapshot:snapshot(),stats,output:outputStats,disposed,sourceName:file?.name,sourceBytes:file?.size});
}
function settings(): void {
  if(!output)return;
  const s = snapshot();
  if (generation !== s.generation) {
    generation = s.generation;
    anchoredGeneration=-1;
    decoder.postMessage({type:'invalidate'});
    output.postMessage({type:'reset',generation,position:s.position_frames});
  }
  output.postMessage({type:'settings',generation,running:s.requested === 'Running' && !s.pending_operation && s.state !== 'Failed',volume:s.volume,mute:s.mute,latency});
}
function command(kind: string, value = 0): void {
  const result = JSON.parse(web.command(kind, value));
  disposed = kind === 'dispose'; failedTag = null;
  settings();
  for (const a of result.actions) {
    if (a.kind === 'open') pendingJob = {type:'open',tag:a.tag,file,preferWebCodecs};
    if (a.kind === 'seek') pendingJob = {type:'seek',tag:a.tag,frame:a.frame,file};
    if (a.kind === 'module') pendingJob = {type:'module',tag:a.tag,frame:a.frame,file,control:a.control};
    if (a.kind === 'close') { pendingJob = null; decoder.postMessage({type:'close'}); output.postMessage({type:'close'}); }
  }
  launch();
  publish();
}
function fail(tag: Tag | undefined, kind: string, detail: string): void {
  if (tag && sameTag(tag,snapshot().tag)) {
    web.failed(JSON.stringify(tag),kind,detail); failedTag = tag;
    decoder.postMessage({type:'cancel'}); settings();
  }
  self.postMessage({type:'error',kind,detail}); publish();
}
decoder.onmessage = e => {
  if (!web) return;
  const m = e.data;
  if(m.type==='capability'){self.postMessage({type:'error',kind:'capability',detail:m.detail});return;}
  if (m.type === 'released') {self.postMessage({type:'released'});return;}
  if (m.type === 'failed' && !m.tag) {fail(snapshot().tag,m.kind,m.detail);return;}
  if (m.type === 'progress') decoder.postMessage({type:'stats-ack'});
  if (!m.tag || !sameTag(m.tag,snapshot().tag) || disposed || failedTag) return;
  if (m.stats) stats = m.stats;
  if (m.type === 'opened') web.opened_facts(JSON.stringify(m.tag),JSON.stringify(m.facts),m.position);
  if(m.module)web.observed(JSON.stringify(m.tag),JSON.stringify(m.module));
  if (m.type === 'landed') web.landed(JSON.stringify(m.tag),m.position);
  if(m.type==='opened'||m.type==='landed')output.postMessage({type:'anchor',generation:m.tag.generation,position:m.position});
  if (m.type === 'eof') web.eof(JSON.stringify(m.tag));
  if (m.type === 'failed') {fail(m.tag,m.kind,m.detail);return;}
  settings(); publish();
};
decoder.onerror = e => {if (web) fail(snapshot().tag,'decoder-failure',e.message);};

self.onmessage = async e => {
  try {
    if (!web) web = await ready;
    const m = e.data;
    if (m.type === 'attach') {
      output = m.control; latency = m.latency;
      output.onmessage = event => {
        const o = event.data;
        if (o.type === 'report') {
          outputStats = o;
          if (!disposed && o.generation === snapshot().generation && anchoredGeneration===o.generation) {
            web.consumed(o.generation,o.position,o.finished);
            if (o.finished) settings();
            publish();
          }
          output.postMessage({type:'report-ack'});
        } else if (o.type === 'reset-ack') {
          if (o.generation === generation) {acknowledgedGeneration = o.generation; launch();}
        } else if(o.type==='anchor-ack') {
          if(o.generation===snapshot().generation){anchoredGeneration=o.generation;decoder.postMessage({type:'anchored',tag:snapshot().tag});}
        } else if (o.type === 'failed') fail(snapshot().tag,'device-unavailable',o.detail);
      };
      decoder.postMessage({type:'init',rate:m.rate,output:m.decode,transport:true},[m.decode]);
      self.postMessage({type:'ready'});
    } else if (m.type === 'load') {
      if (disposed) throw new Error('Disposed output requires a new runtime');
      file = m.file; preferWebCodecs=!!m.preferWebCodecs; command('load');
    } else if (m.type === 'command') command(m.kind,m.value);
    else if (m.type === 'context') {
      contextState = m.state; latency = m.latency;
      web.output_state(contextState === 'running' ? 'running' : contextState === 'closed' ? 'closed' : 'suspended');
      settings(); publish();
    } else if (m.type === 'output-error') fail(snapshot().tag,'device-unavailable',m.detail);
    else if (m.type === 'ack') {outstanding = false; if (dirty) publish();}
  } catch (e) {self.postMessage({type:'error',...failure(e)});}
};
