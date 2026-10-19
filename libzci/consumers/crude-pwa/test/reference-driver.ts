// Test-only consumer of the production decoder worker and its bounded port.
// Compares every normalized sample without putting PCM into the player document.
import { BLOCK_FRAMES, type Tag } from '../src/protocol.js';
const tag=(generation:number):Tag=>({session:1,instance:1,operation:generation,generation});
function run(file:File,reference:Float32Array,start=0,delay=0,rate=48000):Promise<Record<string,unknown>> {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../src/workers/decode-worker.ts',import.meta.url),{type:'module'});
    const channel=new MessageChannel();
    const generation=start?2:1;
    let index=0,frames=0,blocks=0,maxError=0,lastEnd=Math.round(start*48000),stats={};
    let eof=false,inflight=0,highWater=0;
    const outstanding=new Set<number>();
    const timer=setTimeout(()=>done(new Error('reference worker timed out')),30000);
    function done(error?:Error):void {clearTimeout(timer);worker.terminate();channel.port1.close();if(error)reject(error);else resolve({frames,blocks,maxError,highWater,stats,lastEnd});}
    channel.port1.onmessage=e=>{
      const m=e.data;
      if(m.type==='eof' && m.generation===generation) {eof=true;if(!inflight)done();return;}
      if(m.type!=='block')return;
      if(outstanding.has(m.id)) {done(new Error('duplicate pool lease'));return;}
      outstanding.add(m.id);inflight++;highWater=Math.max(highWater,inflight);
      if(m.descriptor.generation===generation) {
        if(m.descriptor.source_start!==lastEnd) {done(new Error(`discontinuous block ${m.descriptor.source_start} != ${lastEnd}`));return;}
        lastEnd=m.descriptor.source_end;
        const samples=new Float32Array(m.pcm,0,m.descriptor.frames*2);
        if(rate===48000) for(const sample of samples) {
          if(!Number.isFinite(sample)||index>=reference.length) {done(new Error('invalid or excess reference samples'));return;}
          maxError=Math.max(maxError,Math.abs(sample-reference[index++]!));
        }
        frames+=m.descriptor.frames;blocks++;
      }
      setTimeout(()=>{
        outstanding.delete(m.id);inflight--;
        channel.port1.postMessage({type:'recycle',id:m.id,pcm:m.pcm},[m.pcm]);
        if(eof&&!inflight)done();
      },delay);
    };
    worker.onerror=e=>done(new Error(e.message));
    worker.onmessage=e=>{
      const m=e.data;
      if(m.type==='ready')worker.postMessage({type:'open',tag:tag(1),file});
      if(m.type==='opened'&&m.tag.generation===1&&start)worker.postMessage({type:'seek',tag:tag(2),frame:Math.round(start*48000)});
      if(m.type==='failed')done(new Error(`${m.kind}: ${m.detail}`));
      if(m.type==='progress'){stats=m.stats;worker.postMessage({type:'stats-ack'});}
      if(m.type==='eof'&&m.tag.generation===generation)stats=m.stats;
    };
    worker.postMessage({type:'init',rate,output:channel.port2},[channel.port2]);
  });
}
async function cancellations(scan:File,replacement:File):Promise<Record<string,unknown>> {
  const worker=new Worker(new URL('../src/workers/decode-worker.ts',import.meta.url),{type:'module'});
  const channel=new MessageChannel();
  channel.port1.onmessage=e=>{const m=e.data;if(m.type==='block')channel.port1.postMessage({type:'recycle',id:m.id,pcm:m.pcm},[m.pcm]);};
  return new Promise((resolve,reject)=>{
    let accepted=0;let began=0;
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('cancelled scan did not release codec'));},10000);
    worker.onmessage=e=>{
      const m=e.data;
      if(m.type==='ready') {
        worker.postMessage({type:'open',tag:tag(1),file:scan});
        setTimeout(()=>{
          began=performance.now();
          // New load/seek/close are posted during a real C callback scan.
          worker.postMessage({type:'open',tag:{...tag(2),instance:2},file:replacement});
          worker.postMessage({type:'seek',tag:{...tag(3),instance:2},file:replacement,frame:2400});
        },10);
      }
      if(m.type==='opened'&&m.tag.generation===3) {
        accepted++;const latency=performance.now()-began;
        worker.postMessage({type:'close'});
        worker.onmessage=event=>{
          if(event.data.type==='released') {clearTimeout(timer);worker.terminate();channel.port1.close();resolve({accepted,latency,position:m.position,stats:m.stats});}
        };
      }
      if(m.type==='failed'&&m.tag?.generation===3){clearTimeout(timer);worker.terminate();reject(new Error(m.detail));}
    };
    worker.postMessage({type:'init',rate:48000,output:channel.port2},[channel.port2]);
  });
}
Object.assign(window,{referenceHarness:{run,cancellations,BLOCK_FRAMES}});
