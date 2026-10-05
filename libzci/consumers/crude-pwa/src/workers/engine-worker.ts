/**
 * Engine worker: owns the WASM core (provider selection, sessions,
 * generations, snapshots). The document sends selected-File header
 * bytes plus decode-worker results; this worker never touches the
 * DOM, SQL, or transport policy beyond core commands. PCM crosses as
 * transferable Float32Arrays, never JSON.
 */
import type { MainToEngine, EngineToMain, Snapshot } from '../protocol.js';
import init, { WebEngine } from '../generated/libzci_web.js';

let engine: WebEngine | null = null;

/**
 * u64 crossing the WASM boundary is a BigInt; the protocol uses numbers
 * (ids/generations never approach 2^53 in a page lifetime). Convert at
 * this boundary only, failing loudly on overflow rather than truncating.
 */
function inId(id: number): bigint {
  if (!Number.isSafeInteger(id) || id < 0) throw new Error(`id out of range: ${id}`);
  return BigInt(id);
}

function outNum(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`u64 out of range: ${value}`);
  return Number(value);
}

async function ready(): Promise<WebEngine> {
  if (!engine) {
    await init();
    engine = new WebEngine();
  }
  return engine;
}

function post(message: EngineToMain, transfer?: Transferable[]): void {
  self.postMessage(message, transfer ?? []);
}

function fail(session: number, error: unknown): void {
  const detail =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  post({ type: 'error', session, kind: 'engine', detail });
}

function snapshotOf(web: WebEngine, session: bigint): Snapshot {
  return JSON.parse(web.snapshot(session)) as Snapshot;
}

self.onmessage = async (event: MessageEvent<MainToEngine>) => {
  const message = event.data;
  try {
    const web = await ready();
    switch (message.type) {
      case 'open': {
        const session = outNum(web.create_session());
        web.open_header(inId(session), new Uint8Array(message.header), message.extensionHint);
        post({ type: 'snapshot', session, snapshot: snapshotOf(web, inId(session)) });
        break;
      }
      case 'commit-index': {
        const committed = JSON.parse(
          web.commit_index(
            inId(message.session),
            JSON.stringify(message.pages),
            message.audioStartPage,
            message.audioStartPacket,
            BigInt(message.preskip),
            message.channels,
          ),
        ) as { total_frames: number; audio_start_page: number; audio_start_packet: number };
        post({
          type: 'index-committed',
          session: message.session,
          totalFrames: committed.total_frames,
          audioStartPage: committed.audio_start_page,
          audioStartPacket: committed.audio_start_packet,
        });
        break;
      }
      case 'ingest-pcm': {
        const ingested = JSON.parse(
          web.ingest_pcm(inId(message.session), inId(message.generation), BigInt(message.startFrame), message.pcm),
        ) as { accepted_frames: number; position_frames: number };
        post({
          type: 'pumped',
          session: message.session,
          generation: message.generation,
          acceptedFrames: ingested.accepted_frames,
          positionFrames: ingested.position_frames,
        });
        break;
      }
      case 'note-eof': {
        web.note_eof(inId(message.session), inId(message.generation));
        post({ type: 'snapshot', session: message.session, snapshot: snapshotOf(web, inId(message.session)) });
        break;
      }
      case 'command': {
        const result = JSON.parse(web.command(inId(message.session), message.kind, BigInt(message.frame ?? 0))) as {
          generation: number;
          snapshot: Snapshot | null;
        };
        if (result.snapshot) {
          post({ type: 'command-result', session: message.session, generation: result.generation, snapshot: result.snapshot });
        } else {
          // Disposed: keep the last snapshot shape with idle state for display.
          post({
            type: 'command-result',
            session: message.session,
            generation: result.generation,
            snapshot: {
              session: message.session,
              revision: 0,
              generation: result.generation,
              state: 'idle',
              provider: null,
              position_frames: 0,
              total_frames: null,
              error: null,
            },
          });
        }
        break;
      }
      case 'seek-plan': {
        const planned = JSON.parse(web.seek_plan(inId(message.session), BigInt(message.target))) as {
          start_page: number;
          skip_packets: number;
          skip_samples: number;
          total_frames: number;
        };
        post({
          type: 'seek-plan',
          session: message.session,
          target: message.target,
          startPage: planned.start_page,
          skipPackets: planned.skip_packets,
          skipSamples: planned.skip_samples,
          totalFrames: planned.total_frames,
        });
        break;
      }
      case 'snapshot': {
        post({ type: 'snapshot', session: message.session, snapshot: snapshotOf(web, inId(message.session)) });
        break;
      }
    }
  } catch (error) {
    const session = typeof event.data === 'object' && event.data !== null && 'session' in event.data
      ? Number((event.data as { session: unknown }).session)
      : -1;
    fail(session, error);
  }
};

export {};
