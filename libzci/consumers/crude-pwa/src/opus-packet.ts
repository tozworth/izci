/**
 * Opus packet duration from the TOC byte (RFC 6716 §3.1), in 48 kHz
 * samples. The decode worker needs exact durations for WebCodecs chunk
 * timestamps; end-trim and preskip stay in the granule math.
 */
const CELT_SIZES = [2.5, 5, 10, 20];

/** Frames per Opus frame for a config index (code 0: single frame).
 * Matches reference `opus_packet_get_samples_per_frame` at 48 kHz
 * (verified against opus-1.5.2 `src/opus.c`). */
function frameSizeMs(config: number): number {
  if (config >= 16) return CELT_SIZES[config % 4]!;
  if (config >= 12) return config % 4 >= 2 ? 20 : 10;
  const low = config % 4;
  return [10, 20, 40, 60][low]!;
}

/**
 * Total decoded samples (at 48 kHz) for one Opus packet.
 * Throws for empty/malformed TOC (caller reports corrupt).
 */
export function opusPacketDurationSamples(packet: Uint8Array): number {
  if (packet.length < 1) throw new Error('empty opus packet');
  const toc = packet[0]!;
  const config = toc >> 3;
  const code = toc & 0x03;
  let count: number;
  if (code === 0) {
    count = 1;
  } else if (code === 3) {
    if (packet.length < 2) throw new Error('truncated opus packet count byte');
    count = packet[1]! & 0x3f;
  } else {
    count = 2;
  }
  return Math.round(count * frameSizeMs(config) * 48);
}

/** Parse an OpusHead packet into operational config. Throws on policy mismatch. */
export function parseOpusHead(packet: Uint8Array): { channels: number; preskip: number; family: number; raw: Uint8Array } {
  if (packet.length < 19) throw new Error('truncated OpusHead');
  const magic = String.fromCharCode(...packet.slice(0, 8));
  if (magic !== 'OpusHead') throw new Error('not OpusHead');
  if (packet[8] !== 1) throw new Error(`OpusHead version ${packet[8]} (expected 1)`);
  const channels = packet[9]!;
  if (channels === 0 || channels > 2) throw new Error(`opus channel count ${channels} (named gap)`);
  const preskip = packet[10]! | (packet[11]! << 8);
  const family = packet[18]!;
  if (family !== 0) throw new Error(`opus mapping family ${family} (named gap)`);
  return { channels, preskip, family, raw: packet.slice(0, 19) };
}
