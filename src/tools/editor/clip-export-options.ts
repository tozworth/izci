export type ClipExportFormat = 'wav' | 'mp3' | 'flac' | 'opus';
export type ClipExportBitrateMode = 'constant' | 'variable';
export type ClipExportSampleRate = 'source' | 44_100 | 48_000;
export type ClipExportChannels = 'source' | 1 | 2;
export type ClipExportBitDepth = 16 | 24 | 32;

export interface ClipExportOptions {
  format: ClipExportFormat;
  bitrateKbps: number;
  bitrateMode: ClipExportBitrateMode;
  sampleRate: ClipExportSampleRate;
  channels: ClipExportChannels;
  bitDepth: ClipExportBitDepth;
}

export const CLIP_EXPORT_FORMATS: readonly ClipExportFormat[] = ['wav', 'mp3', 'flac', 'opus'];

export const DEFAULT_CLIP_EXPORT_OPTIONS: ClipExportOptions = {
  format: 'wav',
  bitrateKbps: 256,
  bitrateMode: 'variable',
  sampleRate: 'source',
  channels: 'source',
  bitDepth: 16
};

export class ClipExportUnavailableError extends Error {
  constructor(readonly format: ClipExportFormat) {
    super(`${format.toUpperCase()} encoding is unavailable in this browser.`);
    this.name = 'ClipExportUnavailableError';
  }
}
