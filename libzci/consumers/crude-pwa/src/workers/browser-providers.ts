// Provider assembly/mechanisms only. Rust owns classification, parameter
// validation, command sequencing, generation fences, conversion and output.
import { WebAudioDecoder } from '../generated/libzci_web.js';
import createModules from '../generated/modules-reference.js';
import moduleWasm from '../generated/modules-reference.wasm?url';
export interface Facts {
  provider:{id:string;name:string;version:string};rate:number;channels:number;total:number|null;
  comments:[string,string][];capabilities:Record<string,number|boolean>;module:unknown;applied?:Record<string,boolean>;
}
export interface Backend {
  facts():Facts;position():number;read():Float32Array|Promise<Float32Array>;seek(target:number):Promise<void>;
  control(kind:string,value:number):Promise<void>;close():void;
  retainedBytes?():number;
}
export async function openProvider(kind:string,id:number,file:File,read:(offset:number,length:number)=>Uint8Array,yieldTask:()=>Promise<void>,check:()=>void):Promise<Backend> {
  if(kind==='ordinary') {
    const decoder=new WebAudioDecoder(id,file.size);
    return {
      facts:()=>JSON.parse(decoder.facts()),position:()=>decoder.position(),read:()=>decoder.read(),
      seek:async target=>{let last=-1;for(;;){check();const p=decoder.seek_step(target);if(p>=target||p===last)break;last=p;await yieldTask();}},
      control:async()=>{throw {kind:'unsupported',detail:'ordinary audio has no module controls'};},close:()=>decoder.free(),
    };
  }
  if(file.size>64*1024*1024)throw {kind:'resource-exhausted',detail:'Module exceeds 64 MiB'};
  const c=await createModules({locateFile:()=>new URL(moduleWasm,import.meta.url).href});check();
  const input=c._malloc(file.size);if(!input)throw {kind:'resource-exhausted',detail:'module buffer allocation'};
  let handle=0,pointer=0;
  try {
    for(let offset=0;offset<file.size;offset+=32768) {
      check();const data=read(offset,Math.min(32768,file.size-offset));
      if(!data.length)throw {kind:'source-access',detail:'Module File became unavailable'};
      c.HEAPU8.set(data,input+offset);if(offset%524288===0)await yieldTask();
    }
    handle=c._zcm_create(input,file.size,Number(kind==='hively'));
    if(!handle)throw {kind:'corrupt',detail:'Module could not be opened'};
  } finally {c._free(input);}
  const probe=async()=>{for(;;){check();const r=c._zcm_probe_step(handle);if(r<0)throw {kind:r===-2?'resource-exhausted':'corrupt',detail:'Module duration exceeded finite scan limit'};if(r===1)break;await yieldTask();}};
  try {await probe();pointer=c._malloc(4096*8);if(!pointer)throw {kind:'resource-exhausted',detail:'module decode buffer'};}
  catch(e){c._zcm_close(handle);throw e;}
  const fact=(n:number):number=>Math.max(0,c._zcm_fact(handle,n));
  const controls=new Map<string,{kind:string;value:number}>();
  const parameters=['subsong','interpolation','ramping','speed','pitch','loops','channel-mute','channel-unmute'];
  const apply=(kind:string,value:number):void=>{if(c._zcm_control(handle,parameters.indexOf(kind),value)!==1)throw {kind:'unsupported',detail:`Module control rejected: ${kind}`};};
  return {
    facts:()=>{
      const channels=Math.min(32,fact(1)),row=fact(4),first=Math.max(0,row-4),rows=Math.min(16,Math.max(0,fact(6)-first));
      const cells:number[][]=[];for(let r=first;r<first+rows;r++)for(let ch=0;ch<channels;ch++)cells.push(Array.from({length:6},(_,cmd)=>c._zcm_cell(handle,r,ch,cmd)));
      return {provider:{id:kind==='hively'?'hivelytracker.replay':'org.openmpt.libopenmpt',name:kind==='hively'?'HivelyTracker':'libopenmpt',version:kind==='hively'?'hivelytracker-f393ca7/m1':'libopenmpt-0.8.4/m1'},rate:48000,channels:2,total:c._zcm_total(handle),
        comments:kind==='hively'?[['title',c.UTF8ToString(c._zcm_text(handle,0))]]:['title','type','tracker','artist','message'].map((k,i)=>[k,c.UTF8ToString(c._zcm_text(handle,i))] as [string,string]),
        capabilities:{subsongs:fact(0),channels:fact(1),interpolation:true,channel_mute:Boolean(fact(9)),ramping:kind==='module',speed:Boolean(fact(7)),pitch:Boolean(fact(8)),loop_limit:kind==='module',patterns:true},
        module:{selected_subsong:fact(2),order:fact(3),pattern:fact(5),row,first_row:first,rows,channels,cells}};
    },
    position:()=>c._zcm_position(handle),
    read:()=>{const frames=c._zcm_read(handle,pointer,4096);if(frames<0)throw {kind:'decoder-failure',detail:'module render failed'};return c.HEAPF32.slice(pointer/4,pointer/4+frames*2);},
    seek:async target=>{for(;;){check();const r=c._zcm_seek_step(handle,target);if(r<0)throw {kind:'decoder-failure',detail:'module seek failed'};if(r===1)break;await yieldTask();}for(const control of controls.values())apply(control.kind,control.value);},
    control:async(kind,value)=>{check();apply(kind,value);if(kind==='subsong'){await probe();return;}const key=kind.startsWith('channel-')?`channel-${value}`:kind;controls.set(key,{kind,value});},
    close:()=>{c._free(pointer);c._zcm_close(handle);},
    retainedBytes:()=>c.HEAPU8.byteLength,
  };
}
