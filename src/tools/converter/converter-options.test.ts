import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONVERTER_SETTINGS,
  changeConverterFormat,
  getEffectiveAudioCodec,
  getEffectiveVideoCodec,
  normalizeConverterSettings,
  outputFileName
} from './converter-options';

describe('converter options', () => {
  it('selects compatible codecs when the container changes', () => {
    const webm = changeConverterFormat(DEFAULT_CONVERTER_SETTINGS, 'webm');
    expect(getEffectiveAudioCodec(webm)).toBe('opus');
    expect(getEffectiveVideoCodec(webm)).toBe('vp8');
  });

  it('builds safe output names with the selected extension', () => {
    expect(outputFileName('mix.final.wav', {
      ...DEFAULT_CONVERTER_SETTINGS,
      format: 'mp3',
      fileSuffix: ' / portable?'
    })).toBe('mix.final_ portable_.mp3');
  });

  it('clamps persisted numeric settings', () => {
    const normalized = normalizeConverterSettings({
      format: 'flac',
      parallelism: 99,
      audioBitrateKbps: 0,
      videoBitrateMbps: Number.NaN,
      keyFrameInterval: -4
    });
    expect(normalized.parallelism).toBe(8);
    expect(normalized.audioBitrateKbps).toBe(6);
    expect(normalized.videoBitrateMbps).toBe(DEFAULT_CONVERTER_SETTINGS.videoBitrateMbps);
    expect(normalized.keyFrameInterval).toBe(0);
  });
});
