/**
 * Crude proof page: file picker, transport buttons, snapshot/decode
 * tables, diagnostics. This module routes worker messages and renders
 * snapshots; it holds no queue, selection policy, DSP, or transport
 * clock. Requested play state and decoded position are shown
 * separately, per the crude diagnostics contract.
 */
import type { DecodeToMain, EngineToMain, Snapshot } from './protocol.js';

const fileInput = document.getElementById('file') as HTMLInputElement;
const openButton = document.getElementById('open') as HTMLButtonElement;
const disposeButton = document.getElementById('dispose') as HTMLButtonElement;
const playButton = document.getElementById('play') as HTMLButtonElement;
const pauseButton = document.getElementById('pause') as HTMLButtonElement;
const stopButton = document.getElementById('stop') as HTMLButtonElement;
const seekFrame = document.getElementById('seek-frame') as HTMLInputElement;
const seekButton = document.getElementById('seek') as HTMLButtonElement;
const snapshotTable = document.getElementById('snapshot') as HTMLTableElement;
const decodeTable = document.getElementById('decode') as HTMLTableElement;
const diagnostics = document.getElementById('diagnostics') as HTMLDivElement;

const engine = new Worker(new URL('./workers/engine-worker.ts', import.meta.url), { type: 'module' });
const decoder = new Worker(new URL('./workers/decode-worker.ts', import.meta.url), { type: 'module' });

interface ActiveLoad {
  loadId: number;
  session: number | null;
  fileName: string;
  fileSize: number;
  totalFrames: number | null;
  audioStartPage: number;
  audioStartPacket: number;
  decodedFrames: number;
  decodedPeak: number;
  decodedSumSquares: number;
  decodedSamples: number;
  maxSingleRead: number;
  indexBytesRead: number;
  staleIngests: number;
}

let nextLoadId = 1;
let active: ActiveLoad | null = null;
const logLines: string[] = [];

function log(line: string): void {
  logLines.push(`${new Date().toISOString()} ${line}`);
  while (logLines.length > 40) logLines.shift();
  diagnostics.textContent = logLines.join('\n');
}

function renderSnapshot(snapshot: Snapshot): void {
  const rows: [string, string][] = [
    ['session', String(snapshot.session)],
    ['revision', String(snapshot.revision)],
    ['generation', String(snapshot.generation)],
    ['requested state', snapshot.state],
    ['provider', snapshot.provider ? `${snapshot.provider.id} ${snapshot.provider.version}` : '—'],
    ['position (frames)', String(snapshot.position_frames)],
    ['total (frames)', snapshot.total_frames === null ? '—' : String(snapshot.total_frames)],
    ['error', snapshot.error ?? '—'],
  ];
  snapshotTable.innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
}

function renderDecode(): void {
  if (!active) {
    decodeTable.innerHTML = '';
    return;
  }
  const rms = active.decodedSamples > 0 ? Math.sqrt(active.decodedSumSquares / active.decodedSamples) : 0;
  const rows: [string, string][] = [
    ['file', `${active.fileName} (${active.fileSize} bytes)`],
    ['decoded frames', String(active.decodedFrames)],
    ['peak |sample|', active.decodedPeak.toFixed(4)],
    ['rms', rms.toFixed(4)],
    ['index bytes read', String(active.indexBytesRead)],
    ['max single read', String(active.maxSingleRead)],
    ['stale ingest refusals', String(active.staleIngests)],
  ];
  decodeTable.innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : null;
}

openButton.onclick = () => {
  const file = fileInput.files?.[0];
  if (!file) {
    log('open: no file selected');
    return;
  }
  const loadId = nextLoadId++;
  active = {
    loadId,
    session: null,
    fileName: file.name,
    fileSize: file.size,
    totalFrames: null,
    audioStartPage: 0,
    audioStartPacket: 0,
    decodedFrames: 0,
    decodedPeak: 0,
    decodedSumSquares: 0,
    decodedSamples: 0,
    maxSingleRead: 0,
    indexBytesRead: 0,
    staleIngests: 0,
  };
  renderDecode();
  log(`open: ${file.name} (${file.size} bytes) as load ${loadId}`);
  decoder.postMessage({ type: 'load', loadId, file, extensionHint: extensionOf(file.name) });
};

disposeButton.onclick = () => {
  if (!active || active.session === null) {
    log('dispose: nothing open');
    return;
  }
  const session = active.session;
  engine.postMessage({ type: 'command', session, kind: 'dispose' });
  decoder.postMessage({ type: 'release', session });
  log(`dispose: session ${session}`);
};

playButton.onclick = () => sendTransport('play');
pauseButton.onclick = () => sendTransport('pause');
stopButton.onclick = () => sendTransport('stop');
seekButton.onclick = () => {
  if (!active || active.session === null) return;
  pendingSeek = { session: active.session, target: Number(seekFrame.value) };
  sendTransport('seek', pendingSeek.target);
};

function sendTransport(kind: 'play' | 'pause' | 'stop' | 'seek', frame?: number): void {
  if (!active || active.session === null) {
    log(`${kind}: nothing open`);
    return;
  }
  engine.postMessage({ type: 'command', session: active.session, kind, frame });
}

/** Latest generation observed per session (routing aid only). */
const generations = new Map<number, number>();
/** A seek awaiting its plan: engine command first, then plan, then decode start. */
let pendingSeek: { session: number; target: number; generation?: number } | null = null;

engine.onmessage = (event: MessageEvent<EngineToMain>) => {
  const message = event.data;
  switch (message.type) {
    case 'snapshot':
      generations.set(message.session, message.snapshot.generation);
      bindSession(message.snapshot);
      renderSnapshot(message.snapshot);
      log(`engine snapshot: session=${message.session} state=${message.snapshot.state} gen=${message.snapshot.generation}`);
      break;
    case 'command-result': {
      generations.set(message.session, message.generation);
      renderSnapshot(message.snapshot);
      log(`engine command: session=${message.session} gen=${message.generation} state=${message.snapshot.state}`);
      // A seek commits a new generation: ask the engine where to start
      // decoding, then hand that plan to the decode worker.
      if (pendingSeek && pendingSeek.session === message.session) {
        pendingSeek.generation = message.generation;
        engine.postMessage({ type: 'seek-plan', session: message.session, target: pendingSeek.target });
      }
      break;
    }
    case 'index-committed': {
      if (!active || active.session !== message.session) break;
      active.totalFrames = message.totalFrames;
      active.audioStartPage = message.audioStartPage;
      active.audioStartPacket = message.audioStartPacket;
      renderDecode();
      log(`index committed: total=${message.totalFrames}`);
      // Initial decode from the top through a seek plan for exactness.
      engine.postMessage({ type: 'seek-plan', session: message.session, target: 0 });
      break;
    }
    case 'seek-plan': {
      if (!active || active.session !== message.session) break;
      const generation = pendingSeek?.session === message.session && pendingSeek.generation !== undefined
        ? pendingSeek.generation
        : (generations.get(message.session) ?? 0);
      pendingSeek = null;
      decoder.postMessage({
        type: 'start',
        session: message.session,
        generation,
        startPage: message.startPage,
        skipPackets: message.skipPackets,
        skipSamples: message.skipSamples,
        targetFrame: message.target,
        totalFrames: message.totalFrames,
      });
      break;
    }
    case 'pumped': {
      if (!active || active.session !== message.session) break;
      engine.postMessage({ type: 'snapshot', session: message.session });
      break;
    }
    case 'error':
      log(`engine error: session=${message.session} ${message.kind}: ${message.detail}`);
      break;
  }
};

decoder.onmessage = (event: MessageEvent<DecodeToMain>) => {
  const message = event.data;
  switch (message.type) {
    case 'header': {
      if (!active || active.loadId !== message.loadId) break;
      active.maxSingleRead = Math.max(active.maxSingleRead, message.maxSingleRead);
      log(`header: ${message.header.byteLength} bytes, file ${message.fileSize}`);
      engine.postMessage(
        { type: 'open', header: message.header, extensionHint: extensionOf(active.fileName) },
        [message.header],
      );
      break;
    }
    case 'index': {
      if (!active || active.loadId !== message.loadId) break;
      active.audioStartPage = message.audioStartPage;
      active.audioStartPacket = message.audioStartPacket;
      active.indexBytesRead = message.bytesRead;
      active.maxSingleRead = Math.max(active.maxSingleRead, message.maxSingleRead);
      renderDecode();
      // The engine session does not exist yet on first index (scan was
      // requested after open); forward for commit once bound.
      if (message.session !== null && active.session === null) active.session = message.session;
      if (active.session !== null) {
        engine.postMessage({
          type: 'commit-index',
          session: active.session,
          pages: message.pages,
          audioStartPage: message.audioStartPage,
          audioStartPacket: message.audioStartPacket,
          preskip: message.preskip,
          channels: message.channels,
        });
      }
      break;
    }
    case 'pcm': {
      if (!active || active.session !== message.session) break;
      // Observe stats locally for the decode-proof table, then forward
      // with transfer for the engine generation check.
      for (let i = 0; i < message.pcm.length; i++) {
        const s = message.pcm[i]!;
        const abs = Math.abs(s);
        if (abs > active.decodedPeak) active.decodedPeak = abs;
        active.decodedSumSquares += s * s;
      }
      active.decodedSamples += message.pcm.length;
      renderDecode();
      const pcm = new Float32Array(message.pcm.length);
      pcm.set(message.pcm);
      engine.postMessage(
        { type: 'ingest-pcm', session: message.session, generation: message.generation, startFrame: message.startFrame, pcm },
        [pcm.buffer as ArrayBuffer],
      );
      break;
    }
    case 'eof': {
      if (!active || active.session !== message.session) break;
      active.decodedFrames = message.frames;
      renderDecode();
      log(`decode eof: gen=${message.generation} frames=${message.frames}`);
      engine.postMessage({ type: 'note-eof', session: message.session, generation: message.generation });
      break;
    }
    case 'failed':
      log(`decode failed: session=${message.session} gen=${message.generation} ${message.kind}: ${message.detail}`);
      break;
    case 'released':
      log(`decode released: session=${message.session}`);
      if (active?.session === message.session) active = null;
      renderDecode();
      break;
  }
};

/** First snapshot after open binds the load to its engine session. */
function bindSession(snapshot: Snapshot): void {
  if (active && active.session === null && snapshot.provider) {
    active.session = snapshot.session;
    decoder.postMessage({ type: 'scan', loadId: active.loadId, session: snapshot.session });
  }
}

log('ready: open an .opus file to begin');
