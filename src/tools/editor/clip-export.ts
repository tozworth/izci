import {
  AudioBufferSource as MediaAudioBufferSource,
  BufferTarget,
  canEncodeAudio,
  FlacOutputFormat,
  Mp3OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  type AudioCodec,
  type AudioEncodingConfig,
  type OutputFormat
} from 'mediabunny';
import { editableTagsToMetadata } from './clip-metadata';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import {
  ClipExportUnavailableError,
  type ClipExportOptions
} from './clip-export-options';
import type { EditableTags } from './tag-writer';

interface ResolvedOutputConfig {
  codec: AudioCodec;
  mimeType: string;
  outputFormat: OutputFormat;
}

function resolveOutputConfig(options: ClipExportOptions): ResolvedOutputConfig {
  switch (options.format) {
    case 'wav':
      return {
        codec: options.bitDepth === 32 ? 'pcm-f32' : options.bitDepth === 24 ? 'pcm-s24' : 'pcm-s16',
        mimeType: 'audio/wav',
        outputFormat: new WavOutputFormat({ metadataFormat: 'id3' })
      };
    case 'mp3':
      return { codec: 'mp3', mimeType: 'audio/mpeg', outputFormat: new Mp3OutputFormat() };
    case 'flac':
      return { codec: 'flac', mimeType: 'audio/flac', outputFormat: new FlacOutputFormat() };
    case 'opus':
      return { codec: 'opus', mimeType: 'audio/ogg', outputFormat: new OggOutputFormat() };
  }
}

async function registerFallbackEncoder(codec: AudioCodec): Promise<void> {
  if (await canEncodeAudio(codec)) return;
  if (codec === 'mp3') {
    const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
    registerMp3Encoder();
  } else if (codec === 'flac') {
    const { registerFlacEncoder } = await import('@mediabunny/flac-encoder');
    registerFlacEncoder();
  }
}

export async function encodeAudioExport(
  buffer: AudioBuffer,
  options: ClipExportOptions,
  tags: EditableTags,
  artwork: Blob | null
): Promise<Blob> {
  const config = resolveOutputConfig(options);
  await registerFallbackEncoder(config.codec);
  logDebug('tools', 'Audio export started', {
    format: options.format,
    codec: config.codec
  });

  const maximumChannels = options.format === 'mp3' || options.format === 'opus' ? 2 : 8;
  const numberOfChannels = options.channels === 'source'
    ? Math.min(buffer.numberOfChannels, maximumChannels)
    : Math.min(options.channels, maximumChannels);
  const sampleRate = options.format === 'opus'
    ? 48_000
    : options.sampleRate === 'source' ? buffer.sampleRate : options.sampleRate;
  const quality = options.format === 'mp3' || options.format === 'opus'
    ? new Quality({ bitrate: options.bitrateKbps * 1000, bitrateMode: options.bitrateMode })
    : undefined;
  if (!await canEncodeAudio(config.codec, { numberOfChannels, sampleRate, quality })) {
    logWarning('tools', 'Audio export codec unavailable', {
      format: options.format,
      codec: config.codec
    });
    throw new ClipExportUnavailableError(options.format);
  }

  const target = new BufferTarget();
  const output = new Output({ format: config.outputFormat, target });
  const encodingConfig: AudioEncodingConfig = {
    codec: config.codec,
    quality,
    transform: {
      numberOfChannels,
      sampleRate,
      ...(options.format === 'flac'
        ? { sampleFormat: options.bitDepth === 16 ? 's16' as const : 's32' as const }
        : {})
    }
  };
  const source = new MediaAudioBufferSource(encodingConfig);
  output.addAudioTrack(source);
  output.setMetadataTags(await editableTagsToMetadata(tags, artwork, options.format));

  await output.start();
  try {
    await source.add(buffer);
    source.close();
    await output.finalize();
  } catch (error) {
    source.close();
    await output.cancel();
    logError('tools', 'Audio export failed', {
      format: options.format,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  if (!target.buffer) throw new Error('The encoded audio buffer was not produced.');
  const blob = new Blob([target.buffer], { type: config.mimeType });
  logInfo('tools', 'Audio export completed', {
    format: options.format,
    bytes: blob.size,
    channels: numberOfChannels,
    sampleRate
  });
  return blob;
}
