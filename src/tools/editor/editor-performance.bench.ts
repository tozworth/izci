import { bench, describe } from 'vitest';
import { createAudioDocument, replaceAudioDocumentRange } from './audio-document';
import { TestAudioBuffer } from './test-audio-buffer';
import { buildWaveformPeakPyramid, waveformPeakAt, waveformPeakBucketSize } from './waveform-peaks';

// Synthetic three-minute stereo PCM. Run: npm exec -- vitest bench --run src/tools/editor/editor-performance.bench.ts
const source = new TestAudioBuffer({ length: 180 * 48_000, sampleRate: 48_000, numberOfChannels: 2 });
const pcm = source as unknown as AudioBuffer;
const document = createAudioDocument(pcm);
const options = { time: 150, iterations: 5, warmupTime: 50 };
let retained: unknown;

describe('three-minute stereo cut', () => {
  bench('full PCM copy (previous edit path)', () => {
    const start = 30 * source.sampleRate;
    const end = 35 * source.sampleRate;
    const output = new TestAudioBuffer({ length: source.length - end + start, sampleRate: source.sampleRate, numberOfChannels: 2 });
    for (let channel = 0; channel < 2; channel += 1) {
      output.getChannelData(channel).set(source.getChannelData(channel).subarray(0, start));
      output.getChannelData(channel).set(source.getChannelData(channel).subarray(end), start);
    }
    retained = output;
  }, options);
  bench('shared source segments (new edit path)', () => {
    retained = replaceAudioDocumentRange(document, 30, 35, null);
  }, options);
});

describe('prepared waveform viewport', () => {
  const peaks = buildWaveformPeakPyramid([source.getChannelData(0), source.getChannelData(1)]);
  const width = 1280;
  const peak = { minimum: 0, maximum: 0 };
  for (const zoom of [1, 16, 64]) {
    const size = waveformPeakBucketSize(source.length / zoom / width);
    bench(`exact stereo peaks, zoom ${zoom}x`, () => {
      const end = Math.min(source.length, source.length / zoom);
      for (let channel = 0; channel < 2; channel += 1) {
        for (let start = 0; start < end; start += size) waveformPeakAt(peaks, channel, start, size, peak);
      }
      retained = peak.maximum;
    }, options);
  }
});

// Keep benchmark results observable without retaining every full-copy allocation.
void retained;
