// Optional platform decoder. Container and audible trim/gain/seek policy stay
// in Rust. Single-link family-0 Opus only; reference remains the default.
import {WebOpusPackets,WebOpusTimeline} from '../generated/libzci_web.js';
import type {Backend,Facts} from './browser-providers.js';
interface AudioFrame {numberOfFrames:number;numberOfChannels:number;copyTo:(out:Float32Array,options:{planeIndex:number;format:string})=>void;close:()=>void}
interface PlatformDecoder {configure:(config:unknown)=>void;decode:(chunk:unknown)=>void;flush:()=>Promise<void>;close:()=>void;state:string}
interface DecoderClass {new(callbacks:{output:(frame:AudioFrame)=>void;error:(error:unknown)=>void}):PlatformDecoder;isConfigSupported:(config:unknown)=>Promise<{supported:boolean}>}
export async function openWebCodecs(id:number,file:File,total:number,yieldTask:()=>Promise<void>,check:()=>void):Promise<Backend> {
  const api=globalThis as unknown as {AudioDecoder?:DecoderClass;EncodedAudioChunk:new(init:unknown)=>unknown};
  if(!api.AudioDecoder)throw {kind:'unsupported',detail:'WebCodecs AudioDecoder unavailable'};
  let packets=new WebOpusPackets(id,file.size);const params=JSON.parse(packets.facts()) as {channels:number;preskip:number;gain:number};
  const config={codec:'opus',sampleRate:48000,numberOfChannels:params.channels};
  try {if(!(await api.AudioDecoder.isConfigSupported(config)).supported)throw {kind:'unsupported',detail:'WebCodecs Opus configuration unavailable'};check();}
  catch(e){packets.free();throw e;}
  let decoded:Float32Array|null=null,error:unknown=null,pending=new Float32Array(0),offset=0,audible=0,sequence=0;
  let timeline=new WebOpusTimeline(total,params.preskip,params.channels,params.gain,0);
  let delivered:(()=>void)|null=null,failed:((error:unknown)=>void)|null=null;
  const create=():PlatformDecoder=>{
    const d=new api.AudioDecoder!({output:frame=>{
      try {
        if(decoded)throw new Error('WebCodecs exceeded one output frame per packet');
        if(frame.numberOfFrames>5760||frame.numberOfChannels!==params.channels)throw new Error('WebCodecs layout/budget changed');
        const samples=new Float32Array(frame.numberOfFrames*params.channels);
        for(let ch=0;ch<params.channels;ch++) {
          const plane=new Float32Array(frame.numberOfFrames);frame.copyTo(plane,{planeIndex:ch,format:'f32-planar'});
          for(let n=0;n<plane.length;n++)samples[n*params.channels+ch]=plane[n]!;
        }
        decoded=samples;
        delivered?.();delivered=null;failed=null;
      }catch(e){error=e;failed?.(e);failed=null;delivered=null;}finally{frame.close();}
    },error:e=>{error=e;failed?.(e);failed=null;delivered=null;}});
    try{d.configure(config);}catch(e){d.close();throw e;}return d;
  };
  let decoder:PlatformDecoder;
  try {decoder=create();}catch(e){packets.free();timeline.free();throw e;}
  const read=async():Promise<Float32Array>=>{
    while(offset===pending.length) {
      check();if(audible>=total)return new Float32Array(0);
      const packet=packets.next();if(!packet.length) {
        if(audible<total)throw {kind:'decoder-failure',detail:'WebCodecs EOF before audible total'};
        return new Float32Array(0);
      }
      decoded=null;
      const output=new Promise<void>((resolve,reject)=>{delivered=resolve;failed=reject;});
      const timestamp=Math.round(sequence*1000000/48000);sequence+=WebOpusPackets.duration(packet);
      decoder.decode(new api.EncodedAudioChunk({type:'key',timestamp,data:packet}));
      await output;check();if(error)throw error;
      pending=timeline.accept(decoded??new Float32Array(0));offset=0;
      await yieldTask();
    }
    const end=Math.min(pending.length,offset+8192),out=pending.slice(offset,end);offset=end;audible+=out.length/2;return out;
  };
  return {
    facts:():Facts=>({provider:{id:'browser.webcodecs.opus',name:'WebCodecs Opus (optional)',version:'single-link-family0/m1'},rate:48000,channels:2,total,comments:[],capabilities:{subsongs:0,channels:0},module:null,applied:{trimmed_preskip:true,trimmed_end:true,applied_header_gain:true}}),
    position:()=>audible,read,
    seek:async target=>{
      check();decoder.close();packets.free();timeline.free();
      packets=new WebOpusPackets(id,file.size);timeline=new WebOpusTimeline(total,params.preskip,params.channels,params.gain,target);
      decoder=create();pending=new Float32Array(0);offset=0;error=null;sequence=0;audible=Math.min(total,target);
      // Decode/discard through Rust at the next read; no full-file PCM buffer.
    },
    control:async()=>{throw {kind:'unsupported',detail:'Opus has no module controls'};},
    close:()=>{if(decoder.state!=='closed')decoder.close();packets.free();timeline.free();},
    interrupt:()=>{const reject=failed;failed=null;delivered=null;reject?.({kind:'cancelled',detail:'platform decode superseded'});},
  };
}
