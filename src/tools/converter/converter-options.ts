import type { AudioCodec, VideoCodec } from 'mediabunny';
import { stripFileExtension } from '$lib/utils/files';

export type ConverterFormatId =
  | 'wav'
  | 'flac'
  | 'mp3'
  | 'ogg-opus'
  | 'ogg-vorbis'
  | 'm4a'
  | 'aac'
  | 'mp4'
  | 'mov'
  | 'mkv'
  | 'webm'
  | 'mpeg-ts';
export type ConverterSampleRate = 'source' | 22_050 | 32_000 | 44_100 | 48_000 | 88_200 | 96_000;
export type ConverterChannels = 'source' | 1 | 2;
export type ConverterPcmFormat = 'u8' | 's16' | 's24' | 's32' | 'f32' | 'f64';
export type ConverterVideoSize = 'source' | '3840x2160' | '2560x1440' | '1920x1080' | '1280x720' | '854x480';
export type ConverterFrameRate = 'source' | 24 | 25 | 30 | 50 | 60;
export type ConverterAudioCodec = AudioCodec | 'none';

export interface ConverterFormatDefinition {
  id: ConverterFormatId;
  label: string;
  extension: string;
  kind: 'audio' | 'video';
  fixedAudioCodec?: AudioCodec;
  audioCodecs: readonly ConverterAudioCodec[];
  videoCodecs: readonly VideoCodec[];
}

const CONTAINER_AUDIO_CODECS = ['aac', 'opus', 'mp3', 'vorbis', 'flac', 'ac3', 'eac3', 'none'] as const;

export const CONVERTER_FORMATS: readonly ConverterFormatDefinition[] = [
  { id: 'wav', label: 'WAV', extension: 'wav', kind: 'audio', fixedAudioCodec: 'pcm-s16', audioCodecs: ['pcm-s16'], videoCodecs: [] },
  { id: 'flac', label: 'FLAC', extension: 'flac', kind: 'audio', fixedAudioCodec: 'flac', audioCodecs: ['flac'], videoCodecs: [] },
  { id: 'mp3', label: 'MP3', extension: 'mp3', kind: 'audio', fixedAudioCodec: 'mp3', audioCodecs: ['mp3'], videoCodecs: [] },
  { id: 'ogg-opus', label: 'Ogg Opus', extension: 'opus', kind: 'audio', fixedAudioCodec: 'opus', audioCodecs: ['opus'], videoCodecs: [] },
  { id: 'ogg-vorbis', label: 'Ogg Vorbis', extension: 'ogg', kind: 'audio', fixedAudioCodec: 'vorbis', audioCodecs: ['vorbis'], videoCodecs: [] },
  { id: 'm4a', label: 'M4A (AAC)', extension: 'm4a', kind: 'audio', fixedAudioCodec: 'aac', audioCodecs: ['aac'], videoCodecs: [] },
  { id: 'aac', label: 'AAC (ADTS)', extension: 'aac', kind: 'audio', fixedAudioCodec: 'aac', audioCodecs: ['aac'], videoCodecs: [] },
  { id: 'mp4', label: 'MP4', extension: 'mp4', kind: 'video', audioCodecs: CONTAINER_AUDIO_CODECS, videoCodecs: ['avc', 'hevc', 'vp9', 'av1', 'vp8', 'prores'] },
  { id: 'mov', label: 'MOV', extension: 'mov', kind: 'video', audioCodecs: CONTAINER_AUDIO_CODECS, videoCodecs: ['avc', 'hevc', 'vp9', 'av1', 'vp8', 'prores'] },
  { id: 'mkv', label: 'Matroska', extension: 'mkv', kind: 'video', audioCodecs: CONTAINER_AUDIO_CODECS, videoCodecs: ['avc', 'hevc', 'vp9', 'av1', 'vp8', 'prores'] },
  { id: 'webm', label: 'WebM', extension: 'webm', kind: 'video', audioCodecs: ['opus', 'vorbis', 'none'], videoCodecs: ['vp8', 'vp9', 'av1'] },
  { id: 'mpeg-ts', label: 'MPEG-TS', extension: 'ts', kind: 'video', audioCodecs: ['aac', 'mp3', 'ac3', 'eac3', 'none'], videoCodecs: ['avc', 'hevc'] }
] as const;

export interface ConverterSettings {
  format: ConverterFormatId;
  audioCodec: ConverterAudioCodec;
  audioBitrateKbps: number;
  audioBitrateMode: 'constant' | 'variable';
  sampleRate: ConverterSampleRate;
  channels: ConverterChannels;
  pcmFormat: ConverterPcmFormat;
  flacBitDepth: 16 | 24;
  videoCodec: VideoCodec;
  videoBitrateMbps: number;
  videoBitrateMode: 'constant' | 'variable';
  videoSize: ConverterVideoSize;
  videoFit: 'contain' | 'cover' | 'fill';
  frameRate: ConverterFrameRate;
  rotate: 0 | 90 | 180 | 270;
  allowRotationMetadata: boolean;
  alpha: 'discard' | 'keep';
  keyFrameInterval: number;
  hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  fastStart: 'off' | 'in-memory' | 'fragmented';
  fragmentDuration: number;
  wavLargeFile: boolean;
  wavMetadata: 'info' | 'id3';
  mp3XingHeader: boolean;
  oggPageDuration: number;
  matroskaClusterDuration: number;
  trackSelection: 'primary' | 'all';
  preserveMetadata: boolean;
  fileSuffix: string;
  preserveFolders: boolean;
  skipExisting: boolean;
  parallelism: number;
}

export const DEFAULT_CONVERTER_SETTINGS: ConverterSettings = {
  format: 'flac',
  audioCodec: 'aac',
  audioBitrateKbps: 192,
  audioBitrateMode: 'variable',
  sampleRate: 'source',
  channels: 'source',
  pcmFormat: 's16',
  flacBitDepth: 24,
  videoCodec: 'avc',
  videoBitrateMbps: 8,
  videoBitrateMode: 'variable',
  videoSize: 'source',
  videoFit: 'contain',
  frameRate: 'source',
  rotate: 0,
  allowRotationMetadata: true,
  alpha: 'discard',
  keyFrameInterval: 5,
  hardwareAcceleration: 'no-preference',
  fastStart: 'in-memory',
  fragmentDuration: 1,
  wavLargeFile: false,
  wavMetadata: 'id3',
  mp3XingHeader: true,
  oggPageDuration: 1,
  matroskaClusterDuration: 1,
  trackSelection: 'primary',
  preserveMetadata: true,
  fileSuffix: '',
  preserveFolders: true,
  skipExisting: true,
  parallelism: 2
};

export const COMPRESSED_AUDIO_CODECS: readonly AudioCodec[] = [
  'aac', 'opus', 'mp3', 'vorbis', 'ac3', 'eac3'
];

export function getConverterFormat(id: ConverterFormatId): ConverterFormatDefinition {
  return CONVERTER_FORMATS.find((format) => format.id === id) ?? CONVERTER_FORMATS[0];
}

export function getEffectiveAudioCodec(settings: ConverterSettings): ConverterAudioCodec {
  const format = getConverterFormat(settings.format);
  if (format.fixedAudioCodec) {
    if (settings.format === 'wav') return pcmCodec(settings.pcmFormat);
    return format.fixedAudioCodec;
  }
  return format.audioCodecs.includes(settings.audioCodec) ? settings.audioCodec : format.audioCodecs[0];
}

export function getEffectiveVideoCodec(settings: ConverterSettings): VideoCodec | null {
  const format = getConverterFormat(settings.format);
  if (format.kind !== 'video') return null;
  return format.videoCodecs.includes(settings.videoCodec) ? settings.videoCodec : format.videoCodecs[0] ?? null;
}

export function pcmCodec(format: ConverterPcmFormat): AudioCodec {
  switch (format) {
    case 'u8': return 'pcm-u8';
    case 's16': return 'pcm-s16';
    case 's24': return 'pcm-s24';
    case 's32': return 'pcm-s32';
    case 'f32': return 'pcm-f32';
    case 'f64': return 'pcm-f64';
  }
}

export function audioSampleFormat(settings: ConverterSettings): 'u8' | 's16' | 's32' | 'f32' | undefined {
  if (settings.format === 'flac') return settings.flacBitDepth === 16 ? 's16' : 's32';
  if (settings.format !== 'wav') return undefined;
  if (settings.pcmFormat === 's24' || settings.pcmFormat === 's32' || settings.pcmFormat === 'f64') return 's32';
  return settings.pcmFormat;
}

export function outputFileName(inputName: string, settings: ConverterSettings): string {
  const base = stripFileExtension(inputName).trim() || 'converted';
  const suffix = settings.fileSuffix.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return `${base}${suffix}.${getConverterFormat(settings.format).extension}`;
}

export function parseVideoSize(size: ConverterVideoSize): { width: number; height: number } | null {
  if (size === 'source') return null;
  const [width, height] = size.split('x').map(Number);
  return { width, height };
}

export function changeConverterFormat(settings: ConverterSettings, formatId: ConverterFormatId): ConverterSettings {
  const format = getConverterFormat(formatId);
  const audioCodec = format.fixedAudioCodec
    ? settings.audioCodec
    : format.audioCodecs.includes(settings.audioCodec) ? settings.audioCodec : format.audioCodecs[0];
  const videoCodec = format.kind === 'video' && !format.videoCodecs.includes(settings.videoCodec)
    ? format.videoCodecs[0]
    : settings.videoCodec;
  return { ...settings, format: formatId, audioCodec, videoCodec };
}

export function normalizeConverterSettings(value: unknown): ConverterSettings {
  const source = value && typeof value === 'object' ? value as Partial<ConverterSettings> : {};
  const format = CONVERTER_FORMATS.some((candidate) => candidate.id === source.format)
    ? source.format as ConverterFormatId
    : DEFAULT_CONVERTER_SETTINGS.format;
  let settings = changeConverterFormat({ ...DEFAULT_CONVERTER_SETTINGS, ...source, format }, format);
  const sampleRates: readonly ConverterSampleRate[] = ['source', 22_050, 32_000, 44_100, 48_000, 88_200, 96_000];
  const channels: readonly ConverterChannels[] = ['source', 1, 2];
  const pcmFormats: readonly ConverterPcmFormat[] = ['u8', 's16', 's24', 's32', 'f32', 'f64'];
  const videoSizes: readonly ConverterVideoSize[] = ['source', '3840x2160', '2560x1440', '1920x1080', '1280x720', '854x480'];
  const frameRates: readonly ConverterFrameRate[] = ['source', 24, 25, 30, 50, 60];
  const audioCodecs: readonly ConverterAudioCodec[] = [...CONTAINER_AUDIO_CODECS, 'pcm-s16'];
  const videoCodecs: readonly VideoCodec[] = ['avc', 'hevc', 'vp9', 'av1', 'vp8', 'prores'];
  settings = {
    ...settings,
    audioCodec: audioCodecs.includes(source.audioCodec as ConverterAudioCodec) ? source.audioCodec as ConverterAudioCodec : DEFAULT_CONVERTER_SETTINGS.audioCodec,
    audioBitrateMode: source.audioBitrateMode === 'constant' ? 'constant' : 'variable',
    audioBitrateKbps: clampNumber(source.audioBitrateKbps, 6, 1024, DEFAULT_CONVERTER_SETTINGS.audioBitrateKbps),
    videoCodec: videoCodecs.includes(source.videoCodec as VideoCodec) ? source.videoCodec as VideoCodec : DEFAULT_CONVERTER_SETTINGS.videoCodec,
    videoBitrateMode: source.videoBitrateMode === 'constant' ? 'constant' : 'variable',
    videoBitrateMbps: clampNumber(source.videoBitrateMbps, 0.1, 500, DEFAULT_CONVERTER_SETTINGS.videoBitrateMbps),
    keyFrameInterval: clampNumber(source.keyFrameInterval, 0, 60, DEFAULT_CONVERTER_SETTINGS.keyFrameInterval),
    fragmentDuration: clampNumber(source.fragmentDuration, 0, 60, DEFAULT_CONVERTER_SETTINGS.fragmentDuration),
    oggPageDuration: clampNumber(source.oggPageDuration, 0.05, 60, DEFAULT_CONVERTER_SETTINGS.oggPageDuration),
    matroskaClusterDuration: clampNumber(source.matroskaClusterDuration, 0, 60, DEFAULT_CONVERTER_SETTINGS.matroskaClusterDuration),
    parallelism: Math.round(clampNumber(source.parallelism, 1, 8, DEFAULT_CONVERTER_SETTINGS.parallelism)),
    sampleRate: sampleRates.includes(source.sampleRate as ConverterSampleRate) ? source.sampleRate as ConverterSampleRate : 'source',
    channels: channels.includes(source.channels as ConverterChannels) ? source.channels as ConverterChannels : 'source',
    pcmFormat: pcmFormats.includes(source.pcmFormat as ConverterPcmFormat) ? source.pcmFormat as ConverterPcmFormat : 's16',
    flacBitDepth: source.flacBitDepth === 16 ? 16 : 24,
    videoSize: videoSizes.includes(source.videoSize as ConverterVideoSize) ? source.videoSize as ConverterVideoSize : 'source',
    frameRate: frameRates.includes(source.frameRate as ConverterFrameRate) ? source.frameRate as ConverterFrameRate : 'source',
    videoFit: source.videoFit === 'cover' || source.videoFit === 'fill' ? source.videoFit : 'contain',
    rotate: source.rotate === 90 || source.rotate === 180 || source.rotate === 270 ? source.rotate : 0,
    allowRotationMetadata: booleanValue(source.allowRotationMetadata, DEFAULT_CONVERTER_SETTINGS.allowRotationMetadata),
    alpha: source.alpha === 'keep' ? 'keep' : 'discard',
    hardwareAcceleration: source.hardwareAcceleration === 'prefer-hardware' || source.hardwareAcceleration === 'prefer-software'
      ? source.hardwareAcceleration
      : 'no-preference',
    fastStart: source.fastStart === 'off' || source.fastStart === 'fragmented' ? source.fastStart : 'in-memory',
    wavLargeFile: booleanValue(source.wavLargeFile, DEFAULT_CONVERTER_SETTINGS.wavLargeFile),
    wavMetadata: source.wavMetadata === 'info' ? 'info' : 'id3',
    mp3XingHeader: booleanValue(source.mp3XingHeader, DEFAULT_CONVERTER_SETTINGS.mp3XingHeader),
    trackSelection: source.trackSelection === 'all' ? 'all' : 'primary',
    preserveMetadata: booleanValue(source.preserveMetadata, DEFAULT_CONVERTER_SETTINGS.preserveMetadata),
    fileSuffix: typeof source.fileSuffix === 'string' ? source.fileSuffix.slice(0, 80) : '',
    preserveFolders: booleanValue(source.preserveFolders, DEFAULT_CONVERTER_SETTINGS.preserveFolders),
    skipExisting: booleanValue(source.skipExisting, DEFAULT_CONVERTER_SETTINGS.skipExisting)
  };
  return changeConverterFormat(settings, settings.format);
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
