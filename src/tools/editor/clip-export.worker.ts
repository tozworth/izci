import {
  AudioSample,
  AudioSampleSource,
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
import {
  ClipExportUnavailableError,
  type ClipExportOptions
} from './clip-export-options';

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

import type { EditorExportRequest, EditorExportResponse } from './clip-export-protocol';

interface ExportWorkerScope {
  onmessage: ((event: MessageEvent<EditorExportRequest>) => void) | null;
  postMessage(message: EditorExportResponse, transfer?: Transferable[]): void;
}

const worker = self as unknown as ExportWorkerScope;
let source: AudioSampleSource | null = null;
let output: Output | null = null;
let target: BufferTarget | null = null;
let sourceRate = 0;
let sourceChannels = 0;
let mimeType = '';

async function start(request: Extract<EditorExportRequest, { type: 'start' }>): Promise<void> {
  const { options, tags, artwork } = request;
  const config = resolveOutputConfig(options);
  await registerFallbackEncoder(config.codec);
  const maximumChannels = options.format === 'mp3' || options.format === 'opus' ? 2 : 8;
  const numberOfChannels = options.channels === 'source'
    ? Math.min(request.numberOfChannels, maximumChannels) : Math.min(options.channels, maximumChannels);
  const sampleRate = options.format === 'opus' ? 48_000
    : options.sampleRate === 'source' ? request.sampleRate : options.sampleRate;
  const quality = options.format === 'mp3' || options.format === 'opus'
    ? new Quality({ bitrate: options.bitrateKbps * 1000, bitrateMode: options.bitrateMode }) : undefined;
  if (!await canEncodeAudio(config.codec, { numberOfChannels, sampleRate, quality })) {
    throw new ClipExportUnavailableError(options.format);
  }
  target = new BufferTarget();
  output = new Output({ format: config.outputFormat, target });
  const encodingConfig: AudioEncodingConfig = {
    codec: config.codec, quality,
    transform: {
      numberOfChannels, sampleRate,
      ...(options.format === 'flac' ? { sampleFormat: options.bitDepth === 16 ? 's16' as const : 's32' as const } : {})
    }
  };
  source = new AudioSampleSource(encodingConfig);
  sourceRate = request.sampleRate;
  sourceChannels = request.numberOfChannels;
  mimeType = config.mimeType;
  output.addAudioTrack(source);
  output.setMetadataTags(await editableTagsToMetadata(tags, artwork, options.format));
  await output.start();
  worker.postMessage({ type: 'ready' });
}

async function handle(request: EditorExportRequest): Promise<void> {
  if (request.type === 'start') { await start(request); return; }
  if (!source || !output || !target) throw new Error('Audio export has not started.');
  if (request.type === 'chunk') {
    const sample = new AudioSample({
      data: new Float32Array(request.data), format: 'f32', numberOfChannels: sourceChannels,
      sampleRate: sourceRate, timestamp: request.timestamp
    });
    try { await source.add(sample); } finally { sample.close(); }
    // One chunk in flight: no queued full-track clone or unbounded message backlog.
    worker.postMessage({ type: 'ready' });
  } else {
    source.close();
    await output.finalize();
    if (!target.buffer) throw new Error('The encoded audio buffer was not produced.');
    worker.postMessage({ type: 'complete', buffer: target.buffer, mimeType }, [target.buffer]);
  }
}

worker.onmessage = (event) => {
  void handle(event.data).catch(async (error) => {
    source?.close();
    try { await output?.cancel(); } catch { /* Preserve the original encoding error. */ }
    worker.postMessage({
      type: 'error', message: error instanceof Error ? error.message : 'Audio export failed.',
      unavailable: error instanceof ClipExportUnavailableError
    });
  });
};
