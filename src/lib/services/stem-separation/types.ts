export const STEM_SAMPLE_RATE = 44_100;
export const STEM_PIPELINE_VERSION = 'bs-polarformer-webgpu-fp16-jsstft-v1';
export const STEM_RESULT_SCHEMA_VERSION = 1;
export const STEM_RESULT_SOFT_CAP_BYTES = 2 * 1024 * 1024 * 1024;

export interface StemPeakPoint {
  mix: number;
  gain: number;
}

export interface StemGpuAdapterInfo {
  requestedPowerPreference: 'high-performance';
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  isFallbackAdapter: boolean;
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
}

export interface StemResultRecord {
  key: string;
  sourceDigest: string;
  sourceQuickKey: string;
  modelDigest: string;
  runtimeDigest: string;
  pipelineVersion: string;
  schemaVersion: number;
  opfsPath: string;
  duration: number;
  sampleRate: number;
  frameCount: number;
  byteSize: number;
  peakTable: StemPeakPoint[];
  adapterInfo?: StemGpuAdapterInfo;
  createdAt: number;
  lastAccessed: number;
}

export interface StemRuntimeRecord {
  id: 'current';
  payloadVersion: number;
  modelDigest: string;
  modelBytes: number;
  runtimeDigest: string;
  runtimeBytes: number;
  opfsPath: string;
  installedAt: number;
  lastVerifiedAt: number;
  adapterInfo?: StemGpuAdapterInfo;
}

export interface StemSourceRecord {
  quickKey: string;
  resultKey: string;
}

export interface StemPlaybackAsset {
  url: string;
  cacheKey: string;
  peakTable: StemPeakPoint[];
}

export type StemTrackStatus =
  | 'hidden'
  | 'checking'
  | 'unsupported'
  | 'setup-required'
  | 'ineligible'
  | 'unprepared'
  | 'processing'
  | 'ready'
  | 'error';

export interface StemSeparationSnapshot {
  enabled: boolean;
  trackId: string | null;
  status: StemTrackStatus;
  message?: string;
  progress: number;
  mix: number;
  playbackAsset: StemPlaybackAsset | null;
  adapterInfo?: StemGpuAdapterInfo;
}

export interface StemCapabilityReport {
  supported: boolean;
  webGpu: boolean;
  shaderF16: boolean;
  maxStorageBuffersPerShaderStage: number;
  reason?: string;
}

export interface StemStorageSummary {
  modelBytes: number;
  resultBytes: number;
  resultCount: number;
  quota?: number;
  usage?: number;
}

export interface StemPayloadInstallProgress {
  state: 'idle' | 'checking' | 'downloading' | 'verifying' | 'validating' | 'installed' | 'error';
  loadedBytes: number;
  totalBytes: number;
  message?: string;
  adapterInfo?: StemGpuAdapterInfo;
}
