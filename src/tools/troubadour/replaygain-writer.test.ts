import { describe, expect, it } from 'vitest';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { buildReplayGainTaggedFile, mergeReplayGainMetadata } from './replaygain-writer';

function makeSilentWav(): File {
  const frameCount = 480;
  const bytes = new Uint8Array(44 + frameCount * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48_000, true);
  view.setUint32(28, 96_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frameCount * 2, true);
  return new File([bytes], 'silence.wav', { type: 'audio/wav' });
}

describe('ReplayGain metadata', () => {
  it('writes ID3 user text without discarding unrelated fields', () => {
    const metadata = mergeReplayGainMetadata({ raw: { TXXX: { MOOD: 'Calm', R128_TRACK_GAIN: '-256' } } }, {
      trackGainDb: -3.125,
      trackPeak: 0.987654321,
      albumGainDb: -2,
      albumPeak: 1.01
    }, 'mp3');
    expect(metadata.raw?.TXXX).toEqual({
      MOOD: 'Calm',
      REPLAYGAIN_TRACK_GAIN: '-3.13 dB',
      REPLAYGAIN_TRACK_PEAK: '0.98765432',
      REPLAYGAIN_ALBUM_GAIN: '-2.00 dB',
      REPLAYGAIN_ALBUM_PEAK: '1.01000000'
    });
  });

  it('writes Vorbis comments and leaves album tags untouched when omitted', () => {
    const metadata = mergeReplayGainMetadata({ raw: { TITLE: 'Track', REPLAYGAIN_ALBUM_GAIN: '-1.00 dB' } }, {
      trackGainDb: 1.5,
      trackPeak: 0.5
    }, 'flac');
    expect(metadata.raw).toMatchObject({
      TITLE: 'Track',
      REPLAYGAIN_TRACK_GAIN: '+1.50 dB',
      REPLAYGAIN_TRACK_PEAK: '0.50000000',
      REPLAYGAIN_ALBUM_GAIN: '-1.00 dB'
    });
  });

  it('remuxes a WAVE file with readable ReplayGain tags', async () => {
    const tagged = await buildReplayGainTaggedFile(makeSilentWav(), {
      trackGainDb: 4.25,
      trackPeak: 0.25
    });
    const input = new Input({ source: new BlobSource(tagged), formats: ALL_FORMATS });
    try {
      const metadata = await input.getMetadataTags();
      expect(metadata.raw?.TXXX).toMatchObject({
        REPLAYGAIN_TRACK_GAIN: '+4.25 dB',
        REPLAYGAIN_TRACK_PEAK: '0.25000000'
      });
    } finally {
      input.dispose();
    }
  });
});
