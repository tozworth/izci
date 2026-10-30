import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const bytes=await readFile(new URL('../src/generated/libzci_audio_web.wasm',import.meta.url));
const module=await WebAssembly.compile(bytes);
test('audio-only WASM has no host imports or transport/catalog entry points',()=>{
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  assert(!WebAssembly.Module.exports(module).some(e=>/session|command|sqlite|decoder/i.test(e.name)));
});

test('real worklet WASM links stereo gain and smoothly retargets unfinished ramps',()=>{
  const w=new WebAssembly.Instance(module,{}).exports,p=w.renderer_new();
  try{
    const input=new Float32Array(w.memory.buffer,w.renderer_input(p),8192),output=new Float32Array(w.memory.buffer,w.renderer_output(p),256);
    input.fill(1);w.renderer_reset(p,1,0);assert.equal(w.renderer_enqueue(p,0,1,0,1024,0,48000,48000,1024),1);
    w.renderer_settings(p,1,1,0,0);w.renderer_process(p);assert(output.every(n=>n===1));
    let last=1;
    for(const [volume,mute]of [[0,0],[0.8,0],[0.8,1],[0.4,1],[0.4,0],[NaN,0]]){
      w.renderer_settings(p,1,volume,mute,0);w.renderer_process(p);
      assert(Math.abs(output[0]-last)<0.005,'retarget anchors to the previous audible frame');
      for(let i=0;i<256;i+=2){assert.equal(output[i],output[i+1],'one gain per stereo frame');assert(Number.isFinite(output[i])&&output[i]>=0&&output[i]<=1);}
      last=output[254];
    }
    assert.equal(w.renderer_position(p),128*7);
  }finally{w.renderer_free(p);}
});
test('initial master volume and mute apply before the first rendered frame',()=>{
  for(const [volume,mute,expected]of [[0.02,0,Math.fround(0.02)],[0.8,1,0]]){
    const w=new WebAssembly.Instance(module,{}).exports,p=w.renderer_new();
    try{
      const input=new Float32Array(w.memory.buffer,w.renderer_input(p),8192),output=new Float32Array(w.memory.buffer,w.renderer_output(p),256);input.fill(1);
      w.renderer_reset(p,1,0);w.renderer_settings(p,1,volume,mute,0);assert.equal(w.renderer_enqueue(p,0,1,0,512,0,48000,48000,512),1);w.renderer_process(p);assert(output.every(n=>n===expected));
      w.renderer_settings(p,1,0.5,0,0);w.renderer_process(p);assert(Math.abs(output[0]-expected)<0.005,'later adjustments retain smoothing');
    }finally{w.renderer_free(p);}
  }
});

test('worklet ABI preserves source-rate positions within blocks and at final drain', () => {
  for (const sourceRate of [44100, 96000, 192000]) {
    const wasm = new WebAssembly.Instance(module, {}).exports;
    const pointer = wasm.renderer_new();
    try {
      wasm.renderer_reset(pointer, 1, 0);
      wasm.renderer_settings(pointer, 1, 1, 0, 0);
      assert.equal(wasm.renderer_enqueue(pointer, 0, 1, 0, Math.floor(4096 * sourceRate / 48000), 0, sourceRate, 48000, 4096), 1);
      wasm.renderer_eof(pointer, 1);
      for (let quantum = 1; quantum <= 32; quantum++) {
        wasm.renderer_process(pointer);
        assert.equal(wasm.renderer_position(pointer), Math.floor(quantum * 128 * sourceRate / 48000), `${sourceRate} Hz quantum ${quantum}`);
        assert.equal(wasm.renderer_consumed(pointer),quantum*128,'consumed duration stays in output-rate frames');
      }
      assert.equal(wasm.renderer_finished(pointer), 1);
    } finally {
      wasm.renderer_free(pointer);
    }
  }
});
test('normalization primes sources, retargets smoothly, and does not advance during starvation',()=>{
  const w=new WebAssembly.Instance(module,{}).exports,p=w.renderer_new();
  try{
    const input=new Float32Array(w.memory.buffer,w.renderer_input(p),8192),output=new Float32Array(w.memory.buffer,w.renderer_output(p),256),heap=w.memory.buffer.byteLength;
    input.fill(1);w.renderer_reset(p,1,0);w.renderer_settings(p,1,1,0,0);w.renderer_replay_gain(p,0.5);
    assert.equal(w.renderer_enqueue(p,0,1,0,384,0,48000,48000,384),1);w.renderer_process(p);assert(output.every(n=>n===0.5));
    w.renderer_replay_gain(p,2);w.renderer_process(p);assert(output[0]>0.5&&output[0]<0.51);let last=output[254];
    w.renderer_replay_gain(p,0.25);w.renderer_process(p);assert(Math.abs(output[0]-last)<0.01);last=output[254];
    for(let i=0;i<10;i++)w.renderer_process(p);assert(output.every(n=>n===0));
    assert.equal(w.renderer_enqueue(p,0,1,384,640,384,48000,48000,256),1);w.renderer_process(p);assert(Math.abs(output[0]-last)<0.01);
    for(let i=0;i<256;i+=2)assert.equal(output[i],output[i+1]);
    w.renderer_reset(p,2,0);w.renderer_replay_gain(p,0.125);assert.equal(w.renderer_enqueue(p,0,2,0,128,0,48000,48000,128),1);w.renderer_process(p);assert(output.every(n=>n===0.125));
    assert.equal(w.memory.buffer.byteLength,heap);
  }finally{w.renderer_free(p);}
});
test('fixed audio pool retains long marked output, tails and generations without heap growth',()=>{
  const w=new WebAssembly.Instance(module,{}).exports;
  const p=w.renderer_new();
  const input=new Float32Array(w.memory.buffer,w.renderer_input(p),8192);
  const output=new Float32Array(w.memory.buffer,w.renderer_output(p),256);
  const heap=w.memory.buffer.byteLength;
  const free=new Set([0,1,2,3,4,5,6,7]);
  const total=4096*8*12+77;
  let submitted=0,received=0,blocks=0,callbacks=0;
  w.renderer_reset(p,1,0);w.renderer_settings(p,1,1,0,960);
  while(!w.renderer_finished(p)) {
    // Variable producer schedule, including long empty/full periods.
    if(callbacks%103<79)while(free.size && submitted<total) {
      const frames=Math.min([4096,13,1024,4095][blocks%4],total-submitted);
      const id=free.values().next().value;
      for(let i=0;i<frames*2;i++)input[i]=(submitted*2+i)%65521;
      assert.equal(w.renderer_enqueue(p,id,1,submitted,submitted+frames,submitted,48000,48000,frames),1);
      free.delete(id);submitted+=frames;blocks++;
    }
    if(!free.size)assert.equal(w.renderer_enqueue(p,99,1,submitted,submitted+1,submitted,48000,48000,1),0);
    if(submitted===total)w.renderer_eof(p,1);
    const before=w.renderer_media(p);w.renderer_process(p);
    const count=w.renderer_media(p)-before;
    for(let i=0;i<count*2;i++)assert.equal(output[i],(received*2+i)%65521);
    received+=count;
    for(let i=0;i<w.renderer_recycled_count(p);i++) {
      const id=w.renderer_recycled(p,i);assert(!free.has(id));free.add(id);
    }
    assert.equal(w.memory.buffer.byteLength,heap);
    assert(w.renderer_position(p)<=received);
    assert(w.renderer_consumed(p)<=received);
    assert(++callbacks<100000);
  }
  assert.equal(received,total);assert.equal(w.renderer_position(p),total);assert.equal(w.renderer_consumed(p),total);assert.equal(free.size,8);
  w.renderer_reset(p,2,5000);
  assert.equal(w.renderer_enqueue(p,0,1,0,1,0,48000,48000,1),0);
  for(let i=0;i<100;i++)w.renderer_process(p);
  assert.equal(w.renderer_consumed(p),0,'new generation and starvation carry no consumed media time');
  assert.equal(w.renderer_position(p),5000);assert.equal(w.renderer_finished(p),0);
  assert(output.every(n=>n===0));
  w.renderer_settings(p,0,1,0,960);const silence=w.renderer_silence(p);
  w.renderer_process(p);assert.equal(w.renderer_silence(p),silence);
  w.renderer_free(p);
});
test('source gain schedules split resampled blocks, prime seeks and reject stale publications',()=>{
  const w=new WebAssembly.Instance(module,{}).exports,p=w.renderer_new();
  try{
    const input=new Float32Array(w.memory.buffer,w.renderer_input(p),8192),output=new Float32Array(w.memory.buffer,w.renderer_output(p),256);input.fill(1);
    w.renderer_reset(p,1,0);w.renderer_settings(p,1,1,0,0);
    assert.equal(w.renderer_gain_begin(p,1),1);for(const [frame,gain]of [[0,0.25],[147,0.5],[294,2]])assert.equal(w.renderer_gain_point(p,frame,gain),1);assert.equal(w.renderer_gain_commit(p,1),1);
    const heap=w.memory.buffer.byteLength;assert.equal(w.renderer_enqueue(p,0,1,0,441,0,44100,48000,480),1);
    const all=[];for(let i=0;i<4;i++){const before=w.renderer_media(p);w.renderer_process(p);all.push(...output.slice(0,(w.renderer_media(p)-before)*2));}
    assert.equal(all.length,960);assert(all.slice(0,320).every(v=>v===0.25));assert(Math.abs(all[320]-(0.25+0.25/240))<1e-7);for(let i=0;i<960;i+=2)assert.equal(all[i],all[i+1]);
    w.renderer_reset(p,2,367);assert.equal(w.renderer_gain_commit(p,1),0);assert.equal(w.renderer_gain_begin(p,1),0);
    assert.equal(w.renderer_gain_begin(p,2),1);assert.equal(w.renderer_gain_point(p,0,0.25),1);assert.equal(w.renderer_gain_point(p,294,2),1);assert.equal(w.renderer_gain_commit(p,2),1);
    assert.equal(w.renderer_enqueue(p,0,2,367,441,400,44100,48000,80),1);w.renderer_process(p);assert(output.slice(0,160).every(v=>v===2));assert.equal(w.memory.buffer.byteLength,heap);
    assert.equal(w.renderer_gain_begin(p,2),1);assert.equal(w.renderer_gain_point(p,NaN,1),0);assert.equal(w.renderer_gain_point(p,0,NaN),0);assert.equal(w.renderer_gain_point(p,0,1),1);assert.equal(w.renderer_gain_point(p,0,2),0);
  }finally{w.renderer_free(p);}
});
