/// <reference types="@webgpu/types" />

import { describe, expect, it, vi } from 'vitest';
import {
  formatStemGpuAdapter,
  requestHighPerformanceStemGpu,
  toStemGpuAdapterInfo
} from './gpu-adapter';

describe('stem WebGPU adapter reporting', () => {
  it('prefers Chromium\'s human-readable adapter description', () => {
    const info = toStemGpuAdapterInfo(
      {
        vendor: 'nvidia',
        architecture: 'blackwell',
        device: '0x2f04',
        description: 'NVIDIA GeForce RTX 5070',
        isFallbackAdapter: false
      },
      { maxBufferSize: 1_000_000_000, maxStorageBufferBindingSize: 500_000_000 }
    );

    expect(info.requestedPowerPreference).toBe('high-performance');
    expect(formatStemGpuAdapter(info)).toBe('NVIDIA GeForce RTX 5070');
  });

  it('falls back to stable adapter fields when description is hidden', () => {
    const info = toStemGpuAdapterInfo(
      {
        vendor: 'intel',
        architecture: 'gen-12lp',
        device: '0x46a6',
        description: '',
        isFallbackAdapter: false
      },
      { maxBufferSize: 268_435_456, maxStorageBufferBindingSize: 134_217_728 }
    );

    expect(formatStemGpuAdapter(info)).toBe('intel gen-12lp 0x46a6');
  });

  it('requests Chromium\'s high-performance adapter without creating a competing device', async () => {
    const limits = {
      maxComputeWorkgroupStorageSize: 32_768,
      maxComputeWorkgroupsPerDimension: 65_535,
      maxStorageBufferBindingSize: 134_217_728,
      maxBufferSize: 268_435_456,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupSizeZ: 64
    };
    const adapterInfo = {
      vendor: 'nvidia',
      architecture: 'blackwell',
      device: '0x2f04',
      description: 'NVIDIA GeForce RTX 5070',
      isFallbackAdapter: false
    };
    const requestDevice = vi.fn();
    const adapter = {
      features: new Set<GPUFeatureName>(['shader-f16', 'subgroups']),
      limits,
      info: adapterInfo,
      requestDevice
    } as unknown as GPUAdapter;
    const requestAdapter = vi.fn().mockResolvedValue(adapter);

    const selected = await requestHighPerformanceStemGpu({ requestAdapter } as unknown as GPU);

    expect(requestAdapter).toHaveBeenCalledWith({
      powerPreference: 'high-performance',
      forceFallbackAdapter: false
    });
    expect(requestDevice).not.toHaveBeenCalled();
    expect(selected.info.description).toBe('NVIDIA GeForce RTX 5070');
  });
});
