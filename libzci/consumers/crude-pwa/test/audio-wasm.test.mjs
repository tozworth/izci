import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const bytes=await readFile(new URL('../src/generated/libzci_audio_web.wasm',import.meta.url));
const module=await WebAssembly.compile(bytes);
test('audio-only WASM has no host imports or transport/catalog entry points',()=>{
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  assert(!WebAssembly.Module.exports(module).some(e=>/session|command|sqlite|decoder/i.test(e.name)));
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
      assert.equal(w.renderer_enqueue(p,id,1,submitted,submitted+frames,submitted,48000,frames),1);
      free.delete(id);submitted+=frames;blocks++;
    }
    if(!free.size)assert.equal(w.renderer_enqueue(p,99,1,submitted,submitted+1,submitted,48000,1),0);
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
    assert(++callbacks<100000);
  }
  assert.equal(received,total);assert.equal(w.renderer_position(p),total);assert.equal(free.size,8);
  w.renderer_reset(p,2,5000);
  assert.equal(w.renderer_enqueue(p,0,1,0,1,0,48000,1),0);
  for(let i=0;i<100;i++)w.renderer_process(p);
  assert.equal(w.renderer_position(p),5000);assert.equal(w.renderer_finished(p),0);
  assert(output.every(n=>n===0));
  w.renderer_settings(p,0,1,0,960);const silence=w.renderer_silence(p);
  w.renderer_process(p);assert.equal(w.renderer_silence(p),silence);
  w.renderer_free(p);
});
