import type { StemCapabilityReport } from './types';

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<{
      features: Set<string>;
      limits: { maxStorageBuffersPerShaderStage: number };
    } | null>;
  };
}

export async function inspectStemCapability(
  navigatorLike: NavigatorWithGpu | undefined =
    typeof navigator === 'undefined' ? undefined : (navigator as NavigatorWithGpu)
): Promise<StemCapabilityReport> {
  if (!navigatorLike?.gpu) {
    return {
      supported: false,
      webGpu: false,
      shaderF16: false,
      maxStorageBuffersPerShaderStage: 0,
      reason: 'WebGPU is unavailable.'
    };
  }

  try {
    const adapter = await navigatorLike.gpu.requestAdapter({ powerPreference: 'high-performance' });

    if (!adapter) {
      return {
        supported: false,
        webGpu: true,
        shaderF16: false,
        maxStorageBuffersPerShaderStage: 0,
        reason: 'No WebGPU adapter is available.'
      };
    }

    const shaderF16 = adapter.features.has('shader-f16');
    const maxStorageBuffersPerShaderStage = adapter.limits.maxStorageBuffersPerShaderStage;
    const supported = shaderF16 && maxStorageBuffersPerShaderStage >= 8;

    return {
      supported,
      webGpu: true,
      shaderF16,
      maxStorageBuffersPerShaderStage,
      reason: !shaderF16
        ? 'The WebGPU adapter does not support shader-f16.'
        : maxStorageBuffersPerShaderStage < 8
          ? 'The WebGPU adapter exposes too few storage buffers.'
          : undefined
    };
  } catch (error) {
    return {
      supported: false,
      webGpu: true,
      shaderF16: false,
      maxStorageBuffersPerShaderStage: 0,
      reason: error instanceof Error ? error.message : 'WebGPU inspection failed.'
    };
  }
}
