import type { OpenMptCore } from './abi';
import createOpenMpt from '$lib/vendor/libopenmpt/runtime.js';
import { loadOpenMptBytes } from './assets';

// Each worker/worklet realm owns one WASM heap; module handles are independent.
let runtime: Promise<OpenMptCore> | undefined;
export function initializeOpenMpt(wasmBinary?: ArrayBuffer): Promise<OpenMptCore> {
  runtime ??= (async () => {
    // Static import is required: import() is forbidden in AudioWorkletGlobalScope.
    const bytes = wasmBinary ?? await loadOpenMptBytes();
    return createOpenMpt({ wasmBinary: bytes, printErr: () => undefined });
  })().catch((error) => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}
