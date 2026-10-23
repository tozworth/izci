import init, { WebEngine } from '../generated/libzci_web.js';
import { failure, sameTag, type Snapshot, type Tag } from '../protocol.js';
import {ProfileController} from './profile-controller.js';
import type {QueueLoad} from '../profile-types.js';

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
let profile:ProfileController|undefined;
let profileReady:Promise<void>|undefined;
let endedGeneration=-1;
let checkpointAt=0;
let restorePlay=false;
function queueLoad(source:File,load:QueueLoad):void {
  self.postMessage({type:'source',file:source});
  file=source;web.load_options(load.position_seconds,load.subsong??undefined);restorePlay=load.autoplay;command('load');
}
function launch(): void {
  if (output && generation>=0 && pendingJob && acknowledgedGeneration === generation) {
    decoder.postMessage(pendingJob); pendingJob = null;
  }
}

function snapshot(): Snapshot {return JSON.parse(web.snapshot()) as Snapshot;}
function publish(): void {
  dirty = true;
  // One UI update in flight: a stalled document never grows a message queue.
  if (outstanding) return;
  outstanding = true; dirty = false;
  self.postMessage({type:'snapshot',snapshot:snapshot(),stats,output:outputStats,disposed,sourceName:file?.name,sourceBytes:file?.size,profile:profile?.snapshot(),access:profile?.access});
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
    if (a.kind === 'open') pendingJob = {type:'open',tag:a.tag,file,preferWebCodecs,start_seconds:a.start_seconds,subsong:a.subsong};
    if (a.kind === 'seek') pendingJob = {type:'seek',tag:a.tag,frame:a.frame,file};
    if (a.kind === 'module') pendingJob = {type:'module',tag:a.tag,frame:a.frame,file,control:a.control};
    if (a.kind === 'close') { pendingJob = null; decoder.postMessage({type:'close'}); output?.postMessage({type:'close'}); }
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
  if(m.type==='opened'&&restorePlay){restorePlay=false;command('play');}
  if(m.module)web.observed(JSON.stringify(m.tag),JSON.stringify(m.module));
  if (m.type === 'landed') web.landed(JSON.stringify(m.tag),m.position);
  if(m.type==='opened'||m.type==='landed')output.postMessage({type:'anchor',generation:m.tag.generation,position:m.position});
  if (m.type === 'eof') web.eof(JSON.stringify(m.tag));
  if (m.type === 'failed') {fail(m.tag,m.kind,m.detail);return;}
  settings(); publish();
};
decoder.onerror = e => {if (web) fail(snapshot().tag,'decoder-failure',e.message);};

self.onmessage = async e => {
  const request=e.data.request;
  try {
    if (!web) web = await ready;
    const m = e.data;
    if(m.type==='profile-init') {
      profileReady=(async()=>{profile=await ProfileController.open(m.name,queueLoad,()=>{if(snapshot().state!=='Idle')command('stop');},(volume,mute)=>{command('volume',volume);command('mute',Number(mute));},publish);publish();self.postMessage({type:'profile-ready'});})();
      await profileReady;const settings=profile!.snapshot().settings;command('volume',settings.volume);command('mute',Number(settings.mute));return;
    }
    if(profileReady)await profileReady;
    if (m.type === 'attach') {
      output = m.control; latency = m.latency;
      output.onmessage = event => {
        const o = event.data;
        if (o.type === 'report') {
          outputStats = o;
          if (!disposed && o.generation === snapshot().generation && anchoredGeneration===o.generation) {
            web.consumed(o.generation,o.position,o.finished);
            if (o.finished) {
              settings();
              if(snapshot().state==='Ended'&&endedGeneration!==o.generation) {
                endedGeneration=o.generation;
                void (async()=>{const s=snapshot();await profile?.command({kind:'checkpoint',position_seconds:s.position_frames/(s.sample_rate??1),subsong:s.module?.selected_subsong??null});if(snapshot().generation===o.generation)await profile?.command({kind:'next',ended:true});})().catch(e=>self.postMessage({type:'error',...failure(e)}));
              }
            } else if(profile?.access==='granted'&&performance.now()-checkpointAt>2000&&!snapshot().pending_operation) {
              checkpointAt=performance.now();const s=snapshot();
              void profile.command({kind:'checkpoint',position_seconds:s.position_frames/(s.sample_rate??1),subsong:s.module?.selected_subsong??null}).catch(e=>self.postMessage({type:'error',...failure(e)}));
            }
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
      settings();publish();
      self.postMessage({type:'ready'});
    } else if (m.type === 'load') {
      if (disposed) throw new Error('Disposed output requires a new runtime');
      preferWebCodecs=!!m.preferWebCodecs;await profile!.ingest([m.file],[],true,m.request);
    } else if(m.type==='ingest') {await profile!.ingest(m.files,m.handles,m.open,m.request);}
    else if(m.type==='queue') {await profile!.command(m.command,m.request);}
    else if(m.type==='restore') {await profile!.restore();}
    else if (m.type === 'command') {
      if(m.kind==='volume')await profile!.command({kind:'volume',volume:m.value},m.request);
      else if(m.kind==='mute')await profile!.command({kind:'mute',mute:!!m.value},m.request);
      else {
        if(m.kind==='play'&&!profile!.snapshot().queue.current) {await profile!.command({kind:'next',ended:false},m.request);}
        if(m.kind==='play'&&!profile!.snapshot().queue.current)throw {kind:'unavailable',detail:'Queue is empty'};
        if(m.kind==='play'&&profile!.access!=='granted')await profile!.restore();
        if(!['pause','stop','dispose'].includes(m.kind)&&profile!.access!=='granted')throw {kind:'access-required',detail:profile!.access||'Select a queue occurrence'};
        command(m.kind,m.value);
        if(['pause','stop','seek','subsong'].includes(m.kind)&&profile?.access==='granted') {const s=snapshot();await profile.command({kind:'checkpoint',position_seconds:m.kind==='seek'?m.value:s.position_frames/(s.sample_rate??1),subsong:m.kind==='subsong'?m.value:s.module?.selected_subsong??null});}
      }
    }
    else if (m.type === 'context') {
      contextState = m.state; latency = m.latency;
      web.output_state(contextState === 'running' ? 'running' : contextState === 'closed' ? 'closed' : 'suspended');
      settings(); publish();
    } else if (m.type === 'output-error') fail(snapshot().tag,'device-unavailable',m.detail);
    else if (m.type === 'ack') {outstanding = false; if (dirty) publish();}
    if(m.request)self.postMessage({type:'result',request:m.request});
  } catch (error) {self.postMessage({type:'error',...failure(error)});if(request)self.postMessage({type:'result',request,error:String(error)});else if(e.data.type==='profile-init')self.postMessage({type:'profile-failed',error:String(error)});}
};
