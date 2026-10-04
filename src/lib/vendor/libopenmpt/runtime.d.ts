import type { OpenMptCore } from '../../services/openmpt/abi';

export default function createOpenMpt(options: {
  wasmBinary: ArrayBuffer | Uint8Array;
  printErr?: () => void;
}): Promise<OpenMptCore>;
