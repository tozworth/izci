export const STEM_PAYLOAD = {
  version: 1,
  revision: '9158719ee2173edd480a735764627526506fe4af',
  modelUrl: '/optional/stem-separation/v1/bs_polarformer_webgpu_fp16.onnx',
  modelBytes: 108_302_219,
  modelSha256: '51015f20d3b2d981eaad706a442b1ce00967826aef2638b324029ca240bd197e',
  modelFileName: 'bs_polarformer_webgpu_fp16.onnx',
  runtimeFileName: 'ort-wasm-simd-threaded.asyncify.wasm',
  runtimeBytes: 24_254_953,
  runtimeSha256: '7e83cd6cee77e478bc96a7e91b198144fb5e4126287daf1f9b54bb195ebcd55a',
  installBytes: 132_557_172
} as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[exponent]}`;
}
