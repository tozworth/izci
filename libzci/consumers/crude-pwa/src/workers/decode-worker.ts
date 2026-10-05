/**
 * Decode worker: owns File bytes, Ogg demux (WASM core reader), and the
 * platform Opus decoder (WebCodecs `AudioDecoder`). It executes the
 * provider operations the engine selects; all open/seek/dispose
 * decisions arrive as messages with generations, and every PCM result
 * carries its generation so the engine can release stale output.
 *
 * Reads are bounded synchronous `FileReaderSync` slices (worker thread
 * only — never the window thread). No whole-file copies: the index
 * scan reads page headers, decode reads one page body at a time.
 * Single-read and page-count bounds are reported with the index so the
 * page can show what the bridge cost.
 */
import type { MainToDecode, DecodeToMain, Generation, PageEntry } from '../protocol.js';
import { hasGranule } from '../protocol.js';
import { opusPacketDurationSamples, parseOpusHead } from '../opus-packet.js';
import init, { WebDemux } from '../generated/libzci_web.js';

const PROBE_BYTES = 8192;
const MAX_SINGLE_READ = 65536 + 512;
const MAX_PAGES = 262144;
const POST_FRAMES = 24000;

let moduleReady: Promise<unknown> | null = null;

async function ready(): Promise<void> {
  moduleReady ??= init();
  await moduleReady;
}

function post(message: DecodeToMain, transfer?: Transferable[]): void {
  self.postMessage(message, transfer ?? []);
}

interface LoadState {
  loadId: number;
  session: number | null;
  file: File;
  reader: FileReaderSync;
  bytesRead: number;
  maxSingleRead: number;
  demux: WebDemux;
  pages: PageEntry[];
  audioStartPage: number;
  audioStartPacket: number;
  preskip: number;
  channels: number;
  opusHead: Uint8Array;
  decoder: AudioDecoder | null;
  decoderFailed: string | null;
  generation: number;
  released: boolean;
}

const loads = new Map<number, LoadState>();
const sessions = new Map<number, LoadState>();

function readSlice(state: LoadState, offset: number, length: number): Uint8Array {
  if (length > MAX_SINGLE_READ) {
    throw { kind: 'resource-exhausted', detail: `slice ${length} exceeds bound ${MAX_SINGLE_READ}` };
  }
  const slice = state.file.slice(offset, offset + length);
  const buffer = state.reader.readAsArrayBuffer(slice) as ArrayBuffer;
  const bytes = new Uint8Array(buffer);
  state.bytesRead += bytes.length;
  state.maxSingleRead = Math.max(state.maxSingleRead, bytes.length);
  return bytes;
}

/** Read exactly `length` bytes unless EOF. */
function readExact(state: LoadState, offset: number, length: number): Uint8Array {
  let remaining = length;
  let position = offset;
  const parts: Uint8Array[] = [];
  while (remaining > 0) {
    const chunk = readSlice(state, position, remaining);
    if (chunk.length === 0) break;
    parts.push(chunk);
    position += chunk.length;
    remaining -= chunk.length;
  }
  const out = new Uint8Array(length - remaining);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function fail(session: number, generation: number, kind: string, detail: string): void {
  post({ type: 'failed', session, generation, kind, detail });
}

self.onmessage = (event: MessageEvent<MainToDecode>) => {
  onMessage(event.data).catch((error: unknown) => {
    const parsed = error as { kind?: unknown; detail?: unknown; message?: unknown };
    fail(-1, 0, typeof parsed.kind === 'string' ? parsed.kind : 'internal', String(parsed.detail ?? parsed.message ?? error));
  });
};

async function onMessage(message: MainToDecode): Promise<void> {
  await ready();
  switch (message.type) {
    case 'load': {
      const state: LoadState = {
        loadId: message.loadId,
        session: null,
        file: message.file,
        reader: new FileReaderSync(),
        bytesRead: 0,
        maxSingleRead: 0,
        demux: new WebDemux(),
        pages: [],
        audioStartPage: 0,
        audioStartPacket: 0,
        preskip: 0,
        channels: 0,
        opusHead: new Uint8Array(),
        decoder: null,
        decoderFailed: null,
        generation: 0,
        released: false,
      };
      loads.set(message.loadId, state);
      try {
        const header = readExact(state, 0, Math.min(PROBE_BYTES, state.file.size));
        const copy = new Uint8Array(header.length);
        copy.set(header);
        post(
          { type: 'header', loadId: message.loadId, header: copy.buffer, fileSize: state.file.size, maxSingleRead: state.maxSingleRead },
          [copy.buffer],
        );
      } catch (error) {
        loads.delete(message.loadId);
        throw error;
      }
      break;
    }
    case 'scan': {
      const state = loads.get(message.loadId);
      if (!state) throw { kind: 'invalid-argument', detail: `unknown load ${message.loadId}` };
      state.session = message.session;
      sessions.set(message.session, state);
      await scanIndex(state);
      break;
    }
    case 'start': {
      const state = sessions.get(message.session);
      if (!state || state.released) return;
      state.generation = message.generation;
      await decodePlan(state, message);
      break;
    }
    case 'release': {
      const state = sessions.get(message.session);
      if (state) {
        state.released = true;
        state.generation += 1;
        try {
          state.decoder?.close();
        } catch { /* already closed */ }
        state.decoder = null;
        state.demux.reset_carry();
        sessions.delete(message.session);
        post({ type: 'released', session: message.session });
      }
      break;
    }
  }
}

/** Bounded page-header scan plus audio-start discovery. */
async function scanIndex(state: LoadState): Promise<void> {
  const session = state.session;
  if (session === null) return;
  const generation = state.generation;
  try {
    let offset = 0;
    let headersFound = 0;
    while (offset < state.file.size) {
      if (state.released) return;
      if (state.pages.length >= MAX_PAGES) {
        throw { kind: 'resource-exhausted', detail: `page count exceeds ${MAX_PAGES}` };
      }
      const fixed = readExact(state, offset, 27);
      if (fixed.length === 0) break;
      if (fixed.length < 27) throw { kind: 'corrupt', detail: `truncated page header at ${offset}` };
      const segCount = fixed[26]!;
      const lacing = readExact(state, offset + 27, segCount);
      if (lacing.length < segCount) throw { kind: 'corrupt', detail: 'truncated lacing table' };
      // Page framing comes from the shared WASM reader (same code as
      // native); only the File reads are adapter-owned.
      const entry = JSON.parse(state.demux.feed_header(fixed, lacing, BigInt(offset))) as PageEntry;
      const bodyLen = entry.body_len;
      const headerType = entry.header_type;
      state.pages.push(entry);
      // Split header-span bodies through the shared WASM reader to find
      // exactly where audio starts (same implementation as native).
      if (headersFound < 2) {
        const body = readExact(state, offset + entry.header_len, bodyLen);
        const packets = state.demux.split_page(body, lacing, headerType) as Uint8Array[];
        for (let i = 0; i < packets.length && headersFound < 2; i++) {
          const packet = packets[i]!;
          if (headersFound === 0) {
            const parsed = parseOpusHead(packet);
            state.preskip = parsed.preskip;
            state.channels = parsed.channels;
            state.opusHead = parsed.raw;
          }
          headersFound += 1;
          if (headersFound === 2) {
            if (i + 1 >= packets.length) {
              // Headers exactly fill the page: audio starts next page.
              state.audioStartPage = state.pages.length;
              state.audioStartPacket = 0;
            } else {
              state.audioStartPage = state.pages.length - 1;
              state.audioStartPacket = i + 1;
            }
          }
        }
      }
      offset += entry.header_len + bodyLen;
    }
    if (headersFound < 2) throw { kind: 'corrupt', detail: 'missing OpusHead/OpusTags' };
    const last = [...state.pages].reverse().find((p) => hasGranule(p));
    const totalEstimate = last ? last.granule - state.preskip : null;
    post({
      type: 'index',
      loadId: state.loadId,
      session,
      pages: state.pages,
      audioStartPage: state.audioStartPage,
      audioStartPacket: state.audioStartPacket,
      preskip: state.preskip,
      channels: state.channels,
      totalEstimate,
      bytesRead: state.bytesRead,
      maxSingleRead: state.maxSingleRead,
    });
  } catch (error) {
    const parsed = error as { kind?: unknown; detail?: unknown; message?: unknown };
    fail(session, generation, typeof parsed.kind === 'string' ? parsed.kind : 'internal', String(parsed.detail ?? parsed.message ?? error));
  }
}

interface StartPlan {
  session: number;
  generation: Generation;
  startPage: number;
  skipPackets: number;
  skipSamples: number;
  targetFrame: number;
  totalFrames: number | null;
}

/**
 * Execute an engine-computed seek plan: fresh platform decoder from the
 * start page, decode-discard `skipSamples`, post the rest tagged with
 * the plan generation. End-trim caps posts at the committed total.
 */
async function decodePlan(state: LoadState, plan: StartPlan): Promise<void> {
  const { session, generation } = plan;
  const alive = (): boolean => !state.released && state.generation === generation;
  try {
    if (typeof AudioDecoder === 'undefined') {
      fail(session, generation, 'unsupported', 'WebCodecs AudioDecoder unavailable');
      return;
    }
    const channels = state.channels;
    if (channels !== 1 && channels !== 2) {
      fail(session, generation, 'unsupported', `channel count ${channels}`);
      return;
    }
    const config: AudioDecoderConfig = {
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: channels as 1 | 2,
      // OpusHead identification header. Whether this exact description
      // shape decodes is proven by browser evidence, pending (1.3).
      description: state.opusHead.buffer as ArrayBuffer,
    };
    const support = await AudioDecoder.isConfigSupported(config);
    if (!alive()) return;
    if (!support.supported) {
      fail(session, generation, 'unsupported', 'opus AudioDecoder config unsupported');
      return;
    }
    try {
      state.decoder?.close();
    } catch { /* already closed */ }
    let outputError: unknown = null;
    const outputs: AudioData[] = [];
    let outputWaiter: (() => void) | null = null;
    const decoder = new AudioDecoder({
      output: (frame: AudioData) => {
        outputs.push(frame);
        if (outputWaiter) {
          outputWaiter();
          outputWaiter = null;
        }
      },
      error: (error: unknown) => {
        outputError = error;
        if (outputWaiter) {
          outputWaiter();
          outputWaiter = null;
        }
      },
    });
    decoder.configure(config);
    state.decoder = decoder;
    state.demux.reset_carry();

    const total = plan.totalFrames;
    let toDrop = plan.skipSamples;
    let audibleCursor = plan.targetFrame;
    let timelineSamples = 0;
    let batch = new Float32Array(POST_FRAMES * channels);
    let batchFrames = 0;
    let batchStart = audibleCursor;
    let decodedSinceStart = 0;

    const flushBatch = (): void => {
      if (batchFrames === 0 || !alive()) return;
      const out = new Float32Array(batchFrames * channels);
      out.set(batch.subarray(0, batchFrames * channels));
      post(
        { type: 'pcm', session, generation, startFrame: batchStart, pcm: out },
        [out.buffer as ArrayBuffer],
      );
      batchStart += batchFrames;
      batchFrames = 0;
    };

    const pushSamples = (interleaved: Float32Array): void => {
      let at = 0;
      let remaining = interleaved.length / channels;
      if (toDrop > 0) {
        const drop = Math.min(toDrop, remaining);
        at += drop * channels;
        remaining -= drop;
        toDrop -= drop;
      }
      if (total !== null) {
        const room = Math.max(0, total - audibleCursor);
        if (room <= 0) {
          remaining = 0;
        } else {
          remaining = Math.min(remaining, room);
        }
      }
      while (remaining > 0) {
        const room = POST_FRAMES - batchFrames;
        const take = Math.min(remaining, room);
        batch.set(interleaved.subarray(at, at + take * channels), batchFrames * channels);
        batchFrames += take;
        audibleCursor += take;
        decodedSinceStart += take;
        at += take * channels;
        remaining -= take;
        if (batchFrames >= POST_FRAMES) flushBatch();
        if (!alive()) return;
      }
    };

    const decodePacket = async (packet: Uint8Array): Promise<void> => {
      const durationSamples = opusPacketDurationSamples(packet);
      const timestamp = Math.round((timelineSamples * 1_000_000) / 48000);
      const duration = Math.round((durationSamples * 1_000_000) / 48000);
      timelineSamples += durationSamples;
      const copy = new Uint8Array(packet.length);
      copy.set(packet);
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp, duration, data: copy.buffer }));
      // Wait for this packet's output (or a decode error).
      while (outputs.length === 0 && outputError === null) {
        if (!alive()) return;
        await new Promise<void>((resolve) => {
          outputWaiter = resolve;
        });
      }
      if (outputError !== null) throw outputError;
      const frame = outputs.shift();
      if (!frame) return;
      try {
        const frames = frame.numberOfFrames;
        const planes: Float32Array[] = [];
        for (let ch = 0; ch < channels; ch++) {
          const size = frame.allocationSize({ planeIndex: ch, format: 'f32-planar' });
          const bytes = new Uint8Array(size);
          frame.copyTo(bytes, { planeIndex: ch, format: 'f32-planar' });
          planes.push(new Float32Array(bytes.buffer, 0, size / 4));
        }
        const interleaved = new Float32Array(frames * channels);
        for (let i = 0; i < frames; i++) {
          for (let ch = 0; ch < channels; ch++) interleaved[i * channels + ch] = planes[ch]![i]!;
        }
        pushSamples(interleaved);
      } finally {
        frame.close();
      }
    };

    // Walk pages from the plan start; skip header packets on the
    // audio-start page by count, then decode.
    let pageIndex = plan.startPage;
    let firstPage = true;
    while (pageIndex < state.pages.length) {
      if (!alive()) return;
      const page = state.pages[pageIndex]!;
      const body = readExact(state, page.offset + page.header_len, page.body_len);
      if (body.length !== page.body_len) {
        throw { kind: 'corrupt', detail: `truncated page body at ${page.offset}` };
      }
      const lacing = readExact(state, page.offset + 27, page.header_len - 27);
      const packets = state.demux.split_page(body, lacing, page.header_type) as Uint8Array[];
      let from = 0;
      if (firstPage && pageIndex === state.audioStartPage) {
        from = Math.min(plan.skipPackets, packets.length);
      }
      firstPage = false;
      for (let i = from; i < packets.length; i++) {
        if (!alive()) return;
        if (total !== null && audibleCursor >= total && toDrop <= 0) break;
        const packet = packets[i]!;
        if (packet.length === 0) continue;
        await decodePacket(packet);
      }
      if (total !== null && audibleCursor >= total && toDrop <= 0) break;
      pageIndex += 1;
    }
    if (!alive()) return;
    try {
      await decoder.flush();
    } catch (error) {
      throw { kind: 'decoder-failure', detail: String(error) };
    }
    flushBatch();
    if (!alive()) return;
    post({ type: 'eof', session, generation, frames: decodedSinceStart });
  } catch (error) {
    if (!alive()) return; // superseded: release quietly, engine owns the error state
    const parsed = error as { kind?: unknown; detail?: unknown; message?: unknown };
    fail(session, generation, typeof parsed.kind === 'string' ? parsed.kind : 'decoder-failure', String(parsed.detail ?? parsed.message ?? error));
  }
}

export {};
