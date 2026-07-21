/// <reference types="@webgpu/types" />

import type { StemGpuAdapterInfo } from './types';

const REQUESTED_POWER_PREFERENCE = 'high-performance' as const;
export interface SelectedStemGpuAdapter {
  adapter: GPUAdapter;
  info: StemGpuAdapterInfo;
}

export function toStemGpuAdapterInfo(
  info: Pick<
    GPUAdapterInfo,
    'vendor' | 'architecture' | 'device' | 'description' | 'isFallbackAdapter'
  >,
  limits: Pick<GPUSupportedLimits, 'maxBufferSize' | 'maxStorageBufferBindingSize'>
): StemGpuAdapterInfo {
  return {
    requestedPowerPreference: REQUESTED_POWER_PREFERENCE,
    vendor: info.vendor || '',
    architecture: info.architecture || '',
    device: info.device || '',
    description: info.description || '',
    isFallbackAdapter: info.isFallbackAdapter === true,
    maxBufferSize: Number(limits.maxBufferSize),
    maxStorageBufferBindingSize: Number(limits.maxStorageBufferBindingSize)
  };
}

export function formatStemGpuAdapter(info: StemGpuAdapterInfo | undefined): string {
  if (!info) return 'Unknown WebGPU adapter';
  return (
    info.description ||
    [info.vendor, info.architecture, info.device].filter(Boolean).join(' ') ||
    'Unnamed WebGPU adapter'
  );
}

export async function requestHighPerformanceStemGpu(gpu: GPU): Promise<SelectedStemGpuAdapter> {
  const adapter = await gpu.requestAdapter({
    powerPreference: REQUESTED_POWER_PREFERENCE,
    forceFallbackAdapter: false
  });
  if (!adapter) throw new Error('Chromium did not return a high-performance WebGPU adapter.');
  if (!adapter.features.has('shader-f16')) {
    throw new Error('The selected high-performance WebGPU adapter does not support shader-f16.');
  }

  const info = toStemGpuAdapterInfo(adapter.info, adapter.limits);
  return { adapter, info };
}
