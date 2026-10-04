import { readFileSync } from 'node:fs';
import type { OpenMptCore } from './abi';

export async function realOpenMpt(): Promise<OpenMptCore> {
  const path = new URL('../../vendor/libopenmpt/runtime.js', import.meta.url).href;
  const { default: initialize } = await import(/* @vite-ignore */ path);
  const bytes = readFileSync(new URL('../../vendor/libopenmpt/libopenmpt.wasm', import.meta.url));
  return initialize({ wasmBinary: bytes, printErr: () => undefined });
}

export function toneModule(twoSubsongs = false): ArrayBuffer {
  const patterns = twoSubsongs ? 2 : 1;
  const bytes = new Uint8Array(1084 + patterns * 1024 + 1024);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('izci WASM test'));
  view.setUint16(42, 512);
  bytes[45] = 64;
  view.setUint16(48, 512);
  bytes[950] = patterns;
  bytes[953] = 1;
  bytes.set(new TextEncoder().encode('M.K.'), 1080);
  for (let pattern = 0; pattern < patterns; pattern++) {
    bytes.set([1, 172, 0x10, 0], 1084 + pattern * 1024);
    // Each disconnected order loops back to itself, producing separate subsongs.
    if (twoSubsongs) bytes.set([0, 0, 0x0b, pattern], 1084 + pattern * 1024 + 16);
  }
  for (let index = 0; index < 1024; index++) bytes[1084 + patterns * 1024 + index] = Math.round(Math.sin(index * Math.PI / 16) * 96) & 0xff;
  return bytes.buffer;
}
