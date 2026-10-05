import { describe, expect, it } from 'vitest';
import { opusPacketDurationSamples, parseOpusHead } from '../src/opus-packet.js';

describe('opus packet durations (reference TOC math)', () => {
  it('decodes single-frame sizes', () => {
    // config 0 (SILK NB 10ms) code 0: 480 samples.
    expect(opusPacketDurationSamples(new Uint8Array([0x00, 0xff]))).toBe(480);
    // config 3 (SILK NB 60ms) code 0: 2880 samples.
    expect(opusPacketDurationSamples(new Uint8Array([0x18, 0xff]))).toBe(2880);
    // config 16 (CELT 2.5ms) code 0: 120 samples.
    expect(opusPacketDurationSamples(new Uint8Array([0x80, 0xff]))).toBe(120);
  });

  it('decodes two-frame and code-3 counts', () => {
    // config 1 code 1 (two 20ms frames): 1920 samples.
    expect(opusPacketDurationSamples(new Uint8Array([0x09]))).toBe(1920);
    // config 0 code 3 with count 13: 13 * 480.
    expect(opusPacketDurationSamples(new Uint8Array([0x03, 13]))).toBe(6240);
  });

  it('rejects empty and truncated packets', () => {
    expect(() => opusPacketDurationSamples(new Uint8Array([]))).toThrow();
    expect(() => opusPacketDurationSamples(new Uint8Array([0x03]))).toThrow();
  });
});

describe('opus head parsing (operational config)', () => {
  function head(overrides: Partial<{ channels: number; preskip: number; family: number }> = {}): Uint8Array {
    const packet = new Uint8Array(19);
    packet.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // OpusHead
    packet[8] = 1;
    packet[9] = overrides.channels ?? 1;
    packet[10] = (overrides.preskip ?? 312) & 0xff;
    packet[11] = ((overrides.preskip ?? 312) >> 8) & 0xff;
    packet[18] = overrides.family ?? 0;
    return packet;
  }

  it('parses mono fixtures', () => {
    expect(parseOpusHead(head())).toMatchObject({ channels: 1, preskip: 312, family: 0 });
  });

  it('rejects policy gaps like the core', () => {
    expect(() => parseOpusHead(head({ channels: 6 }))).toThrow(/named gap/);
    expect(() => parseOpusHead(head({ family: 1 }))).toThrow(/named gap/);
    expect(() => parseOpusHead(new Uint8Array(19))).toThrow();
  });
});
