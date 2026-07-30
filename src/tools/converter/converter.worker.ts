/// <reference lib="webworker" />

import {
  ALL_FORMATS,
  AdtsOutputFormat,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  MpegTsOutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  type AudioCodec,
  type AudioEncodingConfig,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type OutputFormat
} from 'mediabunny';
import { registerFlacEncoder } from '@mediabunny/flac-encoder';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import {
  COMPRESSED_AUDIO_CODECS,
  audioSampleFormat,
  getEffectiveAudioCodec,
  getEffectiveVideoCodec,
  parseVideoSize,
  type ConverterSettings
} from './converter-options';

interface ConvertFileRequest {
  type: 'convert-file';
  file: File;
  settings: ConverterSettings;
}

interface ConvertPcmRequest {
  type: 'convert-pcm';
  channels: ArrayBuffer[];
  sampleRate: number;
  sourceName: string;
  settings: ConverterSettings;
}

type ConverterWorkerRequest = ConvertFileRequest | ConvertPcmRequest;
type ConverterWorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'complete'; buffer: ArrayBuffer; mimeType: string }
  | { type: 'error'; message: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;

function post(message: ConverterWorkerResponse, transfer?: Transferable[]): void {
  worker.postMessage(message, transfer ?? []);
}

function fastStartOptions(settings: ConverterSettings) {
  return settings.fastStart === 'fragmented'
    ? { fastStart: 'fragmented' as const, minimumFragmentDuration: settings.fragmentDuration }
    : { fastStart: settings.fastStart === 'off' ? false as const : 'in-memory' as const };
}

function createOutputFormat(settings: ConverterSettings): { format: OutputFormat; mimeType: string } {
  switch (settings.format) {
    case 'wav':
      return {
        format: new WavOutputFormat({ large: settings.wavLargeFile, metadataFormat: settings.wavMetadata }),
        mimeType: 'audio/wav'
      };
    case 'flac': return { format: new FlacOutputFormat(), mimeType: 'audio/flac' };
    case 'mp3':
      return { format: new Mp3OutputFormat({ xingHeader: settings.mp3XingHeader }), mimeType: 'audio/mpeg' };
    case 'ogg-opus':
    case 'ogg-vorbis':
      return {
        format: new OggOutputFormat({ maximumPageDuration: settings.oggPageDuration }),
        mimeType: settings.format === 'ogg-opus' ? 'audio/ogg; codecs=opus' : 'audio/ogg'
      };
    case 'm4a': return { format: new Mp4OutputFormat(fastStartOptions(settings)), mimeType: 'audio/mp4' };
    case 'aac': return { format: new AdtsOutputFormat(), mimeType: 'audio/aac' };
    case 'mp4': return { format: new Mp4OutputFormat(fastStartOptions(settings)), mimeType: 'video/mp4' };
    case 'mov': return { format: new MovOutputFormat(fastStartOptions(settings)), mimeType: 'video/quicktime' };
    case 'mkv':
      return {
        format: new MkvOutputFormat({ minimumClusterDuration: settings.matroskaClusterDuration }),
        mimeType: 'video/x-matroska'
      };
    case 'webm':
      return {
        format: new WebMOutputFormat({ minimumClusterDuration: settings.matroskaClusterDuration }),
        mimeType: 'video/webm'
      };
    case 'mpeg-ts': return { format: new MpegTsOutputFormat(), mimeType: 'video/MP2T' };
  }
}

async function ensureFallbackEncoder(codec: AudioCodec): Promise<void> {
  if (await canEncodeAudio(codec)) return;
  if (codec === 'mp3') {
    registerMp3Encoder();
  } else if (codec === 'flac') {
    registerFlacEncoder();
  }
}

function audioQuality(settings: ConverterSettings, codec: AudioCodec): Quality | undefined {
  return COMPRESSED_AUDIO_CODECS.includes(codec)
    ? new Quality({
        bitrate: Math.round(settings.audioBitrateKbps * 1000),
        bitrateMode: settings.audioBitrateMode
      })
    : undefined;
}

function resolvedSampleRate(settings: ConverterSettings, codec: AudioCodec): number | undefined {
  if (codec === 'opus') return 48_000;
  return settings.sampleRate === 'source' ? undefined : settings.sampleRate;
}

function createAudioOptions(settings: ConverterSettings): ConversionAudioOptions {
  const codec = getEffectiveAudioCodec(settings);
  if (codec === 'none') return { discard: true };
  return {
    codec,
    quality: audioQuality(settings, codec),
    numberOfChannels: settings.channels === 'source' ? undefined : settings.channels,
    sampleRate: resolvedSampleRate(settings, codec),
    sampleFormat: audioSampleFormat(settings),
    forceTranscode: true
  };
}

function createVideoOptions(settings: ConverterSettings): ConversionVideoOptions {
  const codec = getEffectiveVideoCodec(settings);
  if (!codec) return { discard: true };
  const size = parseVideoSize(settings.videoSize);
  return {
    codec,
    quality: new Quality({
      bitrate: Math.round(settings.videoBitrateMbps * 1_000_000),
      bitrateMode: settings.videoBitrateMode
    }),
    ...(size ? { ...size, fit: settings.videoFit } : {}),
    frameRate: settings.frameRate === 'source' ? undefined : settings.frameRate,
    rotate: settings.rotate,
    allowRotationMetadata: settings.allowRotationMetadata,
    alpha: settings.alpha,
    keyFrameInterval: settings.keyFrameInterval,
    hardwareAcceleration: settings.hardwareAcceleration,
    forceTranscode: true
  };
}

function formatDiscardReason(reason: string): string {
  return reason.replaceAll('_', ' ');
}

async function convertFile(request: ConvertFileRequest): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const audioCodec = getEffectiveAudioCodec(request.settings);
  if (audioCodec !== 'none') await ensureFallbackEncoder(audioCodec);

  const { format, mimeType } = createOutputFormat(request.settings);
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const input = new Input({ source: new BlobSource(request.file), formats: ALL_FORMATS });
  try {
    const audio = createAudioOptions(request.settings);
    const conversion = await Conversion.init({
      input,
      output,
      tracks: request.settings.trackSelection,
      video: request.settings.format === 'wav'
        || request.settings.format === 'flac'
        || request.settings.format === 'mp3'
        || request.settings.format === 'ogg-opus'
        || request.settings.format === 'ogg-vorbis'
        || request.settings.format === 'm4a'
        || request.settings.format === 'aac'
        ? { discard: true }
        : createVideoOptions(request.settings),
      audio,
      tags: request.settings.preserveMetadata ? undefined : {},
      showWarnings: false
    });
    if (!conversion.isValid) {
      const reason = conversion.discardedTracks[0]?.reason;
      throw new Error(reason
        ? `No usable output tracks (${formatDiscardReason(reason)}).`
        : 'No usable audio or video tracks were found.');
    }
    conversion.onProgress = (progress) => post({ type: 'progress', progress });
    await conversion.execute();
    if (!target.buffer) throw new Error('The converted media buffer was not produced.');
    return { buffer: target.buffer, mimeType };
  } finally {
    input.dispose();
  }
}

function createPcmEncodingConfig(settings: ConverterSettings, codec: AudioCodec): AudioEncodingConfig {
  return {
    codec,
    quality: audioQuality(settings, codec),
    transform: {
      numberOfChannels: settings.channels === 'source' ? undefined : settings.channels,
      sampleRate: resolvedSampleRate(settings, codec),
      sampleFormat: audioSampleFormat(settings)
    }
  };
}

async function convertPcm(request: ConvertPcmRequest): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const codec = getEffectiveAudioCodec(request.settings);
  if (codec === 'none') throw new Error('The selected container has audio disabled.');
  await ensureFallbackEncoder(codec);

  const { format, mimeType } = createOutputFormat(request.settings);
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new AudioSampleSource(createPcmEncodingConfig(request.settings, codec));
  output.addAudioTrack(source);
  if (request.settings.preserveMetadata) {
    output.setMetadataTags({ title: request.sourceName.replace(/\.[^.]+$/, '') });
  }

  await output.start();
  try {
    const channels = request.channels.map((buffer) => new Float32Array(buffer));
    const frameCount = Math.min(...channels.map((channel) => channel.length));
    const chunkFrames = 16_384;
    for (let offset = 0; offset < frameCount; offset += chunkFrames) {
      const length = Math.min(chunkFrames, frameCount - offset);
      const interleaved = new Float32Array(length * channels.length);
      for (let frame = 0; frame < length; frame += 1) {
        for (let channel = 0; channel < channels.length; channel += 1) {
          interleaved[frame * channels.length + channel] = channels[channel][offset + frame] ?? 0;
        }
      }
      const sample = new AudioSample({
        data: interleaved,
        format: 'f32',
        numberOfChannels: channels.length,
        sampleRate: request.sampleRate,
        timestamp: offset / request.sampleRate
      });
      try {
        await source.add(sample);
      } finally {
        sample.close();
      }
      post({ type: 'progress', progress: frameCount > 0 ? (offset + length) / frameCount : 1 });
    }
    source.close();
    await output.finalize();
  } catch (error) {
    source.close();
    await output.cancel();
    throw error;
  }

  if (!target.buffer) throw new Error('The converted audio buffer was not produced.');
  return { buffer: target.buffer, mimeType };
}

worker.onmessage = (event: MessageEvent<ConverterWorkerRequest>) => {
  const request = event.data;
  void (request.type === 'convert-file' ? convertFile(request) : convertPcm(request))
    .then(({ buffer, mimeType }) => post({ type: 'complete', buffer, mimeType }, [buffer]))
    .catch((error) => post({
      type: 'error',
      message: error instanceof Error ? error.message : 'Conversion failed.'
    }));
};
