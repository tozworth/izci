import type { StemGpuAdapterInfo, StemPeakPoint } from './types';

export type StemWorkerRequest =
  | { type: 'validate'; model: ArrayBuffer }
  | {
      type: 'process';
      model: ArrayBuffer;
      left: ArrayBuffer;
      right: ArrayBuffer;
      totalSamples: number;
    };

export type StemWorkerResponse =
  | { type: 'adapter'; adapterInfo: StemGpuAdapterInfo }
  | { type: 'validated'; adapterInfo: StemGpuAdapterInfo }
  | { type: 'progress'; progress: number }
  | {
      type: 'complete';
      wav: ArrayBuffer;
      peakTable: StemPeakPoint[];
      frameCount: number;
      adapterInfo: StemGpuAdapterInfo;
    }
  | { type: 'error'; message: string };
