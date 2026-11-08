/// <reference lib="webworker" />
import init, {
  WebAudioDecoder,
  WebEngine,
  WebPreparation,
  classify,
  MetadataBudget,
  normalize_metadata
} from '../../../../libzci/consumers/crude-pwa/src/generated/libzci_web.js';
import createCodec from '../../../../libzci/consumers/crude-pwa/src/generated/opus-reference.js';
import codecWasm from '../../../../libzci/consumers/crude-pwa/src/generated/opus-reference.wasm?url';
import {
  BLOCK_FRAMES,
  POOL_SIZE,
  type CoreFacts,
  type CoreSnapshot,
  type CoreTag,
  type WorkerRequest
} from './protocol';

interface DecoderBackend {
  facts(): CoreFacts;
  position(): number;
  read(): Float32Array | Promise<Float32Array>;
  seek(target: number): Promise<void>;
  close(): void;
  interrupt?(): void;
}

interface CurrentSource {
  tag: CoreTag;
  backend: DecoderBackend;
  facts: CoreFacts;
  preparation: WebPreparation;
  sourceEof: boolean;
  eofSent: boolean;
  cancelled: boolean;
}

type Tag = CoreTag;

let web: WebEngine | null = null;
let codec: any = null;
let output: MessagePort | null = null;
let control: MessagePort | null = null;
let outputRate = 48_000;
let latencyFrames = 0;
let current: CurrentSource | null = null;
let source: { file: File; id: number; error: unknown; reads: number } | null = null;
let nextSourceId = 1;
let running = false;
let free = new Map<number, ArrayBuffer>();
let generation = -1;
let lastPublishedAt = -1;
let lastPublishedRevision = -1;
let lastPublishedState = '';
let endedPublished = false;
let anchorWaiters = new Map<number, () => void>();
let pendingDrive = false;

// A task-channel continuation lets codec/scan work yield to worker messages
// without depending on background-timer cadence.
const tasks = new MessageChannel();
let continuation: (() => void) | null = null;
tasks.port1.onmessage = () => {
  const resume = continuation;
  continuation = null;
  resume?.();
};
function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    if (continuation) throw new Error('reentrant decoder task');
    continuation = resolve;
    tasks.port2.postMessage(null);
  });
}

function post(message: unknown): void {
  self.postMessage(message);
}

function checkCancelled(): void {
  if (current?.cancelled) throw { kind: 'cancelled', detail: 'operation superseded' };
}

function readBytes(position: number, length: number): Uint8Array {
  checkCancelled();
  if (!source) throw { kind: 'source-access', detail: 'File unavailable' };
  try {
    const reader = new FileReaderSync();
    const data = new Uint8Array(reader.readAsArrayBuffer(source.file.slice(position, position + length)));
    source.reads += 1;
    return data;
  } catch (error) {
    throw { kind: 'source-access', detail: String(error) };
  }
}

Object.assign(globalThis, {
  libzciRead: (id: number, position: number, length: number): Uint8Array => {
    if (id !== source?.id) throw new Error('stale File identity');
    return readBytes(position, length);
  }
});

async function readSource(id: number, position: number, pointer: number, length: number): Promise<number> {
  const snapshot = source;
  try {
    if (!snapshot || snapshot.id !== id || current?.cancelled) throw { kind: 'cancelled', detail: 'source invalidated' };
    if (++snapshot.reads % 16 === 0) await yieldTask();
    checkCancelled();
    if (length < 0 || length > 32_768) throw { kind: 'resource-exhausted', detail: 'C read exceeded 32 KiB' };
    const data = new FileReaderSync().readAsArrayBuffer(snapshot.file.slice(position, position + length));
    codec.HEAPU8.set(new Uint8Array(data), pointer);
    return data.byteLength;
  } catch (error) {
    if (snapshot) snapshot.error = (error as { kind?: string })?.kind ? error : { kind: 'source-access', detail: String(error) };
    return -1;
  }
}

function tagString(tag: Tag): string {
  return JSON.stringify(tag);
}

async function call(name: string, args: number[]): Promise<number> {
  if (!codec) throw { kind: 'unavailable', detail: 'Reference Opus was not initialized' };
  if (source) source.error = null;
  const result = await codec.ccall(name, 'number', args.map(() => 'number'), args, { async: true });
  if (source?.error) throw source.error;
  checkCancelled();
  if (result < 0) throw { kind: result === -130 ? 'unsupported' : 'decoder-failure', detail: `${name}: opusfile ${result}` };
  return result;
}

function ordinaryBackend(id: number, file: File): DecoderBackend {
  const decoder = new WebAudioDecoder(id, file.size);
  return {
    facts: () => JSON.parse(decoder.facts()) as CoreFacts,
    position: () => decoder.position(),
    read: () => decoder.read(),
    seek: async (target) => {
      let last = -1;
      for (;;) {
        checkCancelled();
        const position = decoder.seek_step(target);
        if (position >= target || position === last) break;
        last = position;
        await yieldTask();
      }
    },
    close: () => decoder.free()
  };
}

async function opusBackend(id: number, file: File): Promise<DecoderBackend> {
  if (!codec) {
    codec = await createCodec({ locateFile: () => new URL(codecWasm, import.meta.url).href, readSource });
  }
  const handle = codec._zci_create(id, file.size);
  if (!handle) throw { kind: 'resource-exhausted', detail: 'codec context allocation failed' };
  try {
    await call('zci_open', [handle]);
  } catch (error) {
    codec._zci_close(handle);
    throw error;
  }

  const comments: Array<[string, string]> = [];
  const normalizationPoints: NonNullable<CoreFacts['normalization_points']> = [];
  const text = new TextDecoder();
  const budget = new MetadataBudget();
  let sourceFrame = 0;
  try {
    for (let link = 0; link < codec._zci_links(handle); link += 1) {
      const start = comments.length;
      for (let index = 0; index < codec._zci_comment_count(handle, link); index += 1) {
        const length = codec._zci_comment_length(handle, link, index);
        const pointer = codec._zci_comment_data(handle, link, index);
        if (length < 0 || pointer < 0 || (length && !pointer) || pointer + length > codec.HEAPU8.length) {
          throw { kind: 'corrupt', detail: 'Invalid bounded Opus comment' };
        }
        budget.reserve(length);
        const bytes = codec.HEAPU8.subarray(pointer, pointer + length);
        const separator = bytes.subarray(0, 257).indexOf(61);
        if (separator >= 0) {
          const key = text.decode(bytes.subarray(0, separator));
          if (budget.visible(key, length)) comments.push([key.replace(/[a-z]/g, (character: string) => character.toUpperCase()), text.decode(bytes.subarray(separator + 1))]);
        }
      }
      const frames = codec._zci_link_total(handle, link);
      if (!Number.isSafeInteger(frames) || frames < 0) throw { kind: 'corrupt', detail: 'Invalid Opus link timeline' };
      if (frames > 0) {
        try {
          const normalized = JSON.parse(normalize_metadata(JSON.stringify(comments.slice(start)), undefined, ''));
          if (normalized?.replay_gain) normalizationPoints.push({ source_frame: sourceFrame, tags: normalized.replay_gain });
        } catch {
          // Malformed optional gain tags do not prevent playback.
        }
      }
      sourceFrame += frames;
    }
  } finally {
    budget.free();
  }

  return {
    facts: () => ({
      provider: { id: 'org.xiph.opus', name: 'Reference Opus (libopusfile)', version: 'libopusfile-0.12/libopus-1.5.2/r5' },
      rate: 48_000,
      channels: 2,
      total: codec._zci_total(handle),
      comments,
      capabilities: { subsongs: 0, channels: 0 },
      module: null,
      applied: { trimmed_preskip: true, trimmed_end: true, applied_header_gain: true },
      normalization_points: normalizationPoints
    }),
    position: () => codec._zci_position(handle),
    read: async () => {
      const pointer = codec._malloc(BLOCK_FRAMES * 2 * 4);
      if (!pointer) throw { kind: 'resource-exhausted', detail: 'decode buffer allocation failed' };
      try {
        const frames = await call('zci_read', [handle, pointer, BLOCK_FRAMES * 2]);
        return codec.HEAPF32.slice(pointer / 4, pointer / 4 + frames * 2);
      } finally {
        codec._free(pointer);
      }
    },
    seek: async (target) => {
      checkCancelled();
      await call('zci_seek', [handle, target]);
    },
    close: () => {
      if (handle) codec._zci_close(handle);
    },
    interrupt: () => undefined
  };
}

async function openBackend(file: File, startSeconds: number): Promise<DecoderBackend> {
  const id = nextSourceId++;
  source = { file, id, error: null, reads: 0 };
  const hint = file.name.split('.').pop()?.toLowerCase() ?? '';
  const kind = classify(readBytes(0, 8192), hint);
  if (kind !== 'ordinary' && kind !== 'opus') {
    throw { kind: 'unsupported', detail: kind === 'module' || kind === 'hively' ? 'Tracker playback is not yet on the Svelte libzci bridge' : 'No ordinary-audio provider claimed this File' };
  }
  const backend = kind === 'opus' ? await opusBackend(id, file) : ordinaryBackend(id, file);
  const facts = backend.facts();
  if (startSeconds > 0 && facts.total !== 0) {
    const target = Math.min(facts.total ?? Number.POSITIVE_INFINITY, Math.round(startSeconds * facts.rate));
    await backend.seek(target);
  }
  return backend;
}

function snapshot(): CoreSnapshot {
  if (!web) throw new Error('Engine not initialized');
  return JSON.parse(web.snapshot()) as CoreSnapshot;
}

function closeCurrent(): void {
  const active: CurrentSource | null = current;
  current = null;
  if (!active) return;
  active.cancelled = true;
  try { active.backend.interrupt?.(); } catch { /* best effort */ }
  try { active.backend.close(); } catch { /* best effort */ }
  try { active.preparation.free(); } catch { /* best effort */ }
  source = null;
}

function publish(force = false): void {
  if (!web) return;
  const core = snapshot();
  const now = performance.now();
  if (!force && core.revision === lastPublishedRevision && now - lastPublishedAt < 100) return;
  if (!force && now - lastPublishedAt < 100 && core.state === lastPublishedState) return;
  lastPublishedAt = now;
  lastPublishedRevision = core.revision;
  lastPublishedState = core.state;
  const ended = core.state === 'Ended' && !endedPublished;
  if (ended) endedPublished = true;
  const facts = current?.facts ?? null;
  post({ type: 'snapshot', core, facts, ended });
}

function sendSettings(): void {
  if (!control || !web) return;
  const core = snapshot();
  control.postMessage({
    type: 'settings',
    generation: core.generation,
    running: core.requested === 'Running' && !core.pending_operation && core.state !== 'Failed',
    volume: 1,
    mute: false,
    replayGain: 1,
    latency: latencyFrames
  });
}

function syncOutput(forceReset = false): void {
  if (!control || !web) return;
  const core = snapshot();
  if (forceReset || core.generation !== generation) {
    generation = core.generation;
    control.postMessage({ type: 'reset', generation, position: core.position_frames });
  }
  sendSettings();
}

function waitForAnchor(value: number): Promise<void> {
  return new Promise((resolve) => {
    anchorWaiters.set(value, resolve);
    setTimeout(() => {
      if (anchorWaiters.delete(value)) resolve();
    }, 1_500);
  });
}

async function performOpen(action: { tag: Tag; start_seconds?: number }, file: File, startSeconds: number): Promise<void> {
  closeCurrent();
  endedPublished = false;
  const backend = await openBackend(file, startSeconds);
  const facts = backend.facts();
  const position = backend.position();
  if (!web!.opened_facts(tagString(action.tag), JSON.stringify(facts), position)) {
    backend.close();
    return;
  }
  const preparation = WebPreparation.for_layout(facts.rate, facts.channels, outputRate, action.tag.generation);
  current = { tag: action.tag, backend, facts, preparation, sourceEof: false, eofSent: false, cancelled: false };
  generation = action.tag.generation;
  control?.postMessage({ type: 'anchor', generation, position });
  await waitForAnchor(generation);
  syncOutput();
  publish(true);
}

async function performSeek(action: { tag: Tag; frame?: number }): Promise<void> {
  const active = current;
  if (!active) throw { kind: 'cancelled', detail: 'source not opened' };
  // Detach the old generation so the decode loop cannot start another read while
  // the provider repositions. Preparation is generation-scoped and rebuilt so
  // retained PCM and converter tails cannot cross the seek boundary.
  current = null;
  active.sourceEof = false;
  active.eofSent = false;
  const target = Math.min(active.facts.total ?? Number.POSITIVE_INFINITY, action.frame ?? 0);
  await active.backend.seek(target);
  active.preparation.free();
  active.preparation = WebPreparation.for_layout(active.facts.rate, active.facts.channels, outputRate, action.tag.generation);
  current = active;
  active.tag = action.tag;
  const position = active.backend.position();
  if (!web!.landed(tagString(action.tag), position)) return;
  generation = action.tag.generation;
  control?.postMessage({ type: 'anchor', generation, position });
  await waitForAnchor(generation);
  syncOutput();
  publish(true);
  void drive();
}

function runCommand(kind: string, value: number): any {
  if (!web) throw new Error('Engine not initialized');
  const response = JSON.parse(web.command(kind, value));
  syncOutput();
  return response;
}

async function settleActions(response: any, file: File | null, autoPlay: boolean, startSeconds: number): Promise<void> {
  for (const action of response.actions ?? []) {
    if (action.kind === 'open') {
      if (!file) throw { kind: 'unavailable', detail: 'No File for open action' };
      await performOpen(action, file, startSeconds);
    } else if (action.kind === 'seek') {
      await performSeek(action);
    } else if (action.kind === 'close') {
      closeCurrent();
    }
  }
  if (autoPlay && snapshot().requested !== 'Running') {
    runCommand('play', 0);
  }
  if (snapshot().requested === 'Running') void drive();
}

async function drive(): Promise<void> {
  if (running || !current || !web || !output || !free.size) return;
  if (snapshot().requested !== 'Running' || snapshot().pending_operation) return;
  running = true;
  try {
    for (;;) {
      const active: CurrentSource | null = current;
      if (!active || active.cancelled) break;
      if (!web || snapshot().generation !== active.tag.generation) break;
      if (snapshot().requested !== 'Running' || !free.size) break;

      if (!active.sourceEof && active.preparation.needs_input()) {
        const start = active.backend.position();
        const samples = await active.backend.read();
        if (current !== active || active.cancelled) break;
        if (!samples.length) {
          active.sourceEof = true;
          active.preparation.finish();
        } else {
          active.preparation.accept(start, samples);
        }
      }

      const pcm = active.preparation.pull();
      if (pcm.length) {
        const [id, buffer] = free.entries().next().value!;
        free.delete(id);
        new Float32Array(buffer).set(pcm);
        output.postMessage({
          type: 'block',
          id,
          pcm: buffer,
          descriptor: JSON.parse(active.preparation.descriptor())
        }, [buffer]);
      }
      if (active.preparation.drained() && !active.eofSent) {
        active.eofSent = true;
        web.eof(tagString(active.tag));
        output.postMessage({ type: 'eof', generation: active.tag.generation });
        publish(true);
        break;
      }
      await yieldTask();
    }
  } catch (error) {
    if (current && !current.cancelled) {
      const failure = error as { kind?: string; detail?: string; message?: string };
      if (web) web.failed(tagString(current.tag), failure.kind ?? 'decoder-failure', String(failure.detail ?? failure.message ?? error));
      post({ type: 'error', kind: failure.kind ?? 'decoder-failure', detail: String(failure.detail ?? failure.message ?? error) });
      publish(true);
    }
  } finally {
    running = false;
    if (pendingDrive) {
      pendingDrive = false;
      queueMicrotask(() => void drive());
    }
  }
}

function attach(message: any): void {
  output = message.decode as MessagePort;
  control = message.control as MessagePort;
  outputRate = Number(message.rate);
  latencyFrames = Number(message.latency ?? 0);
  output.onmessage = (event: MessageEvent) => {
    const data = event.data;
    if (data?.type !== 'recycle') return;
    if (data.id < 0 || data.id >= POOL_SIZE || free.has(data.id) || data.pcm.byteLength !== BLOCK_FRAMES * 8) {
      post({ type: 'error', kind: 'resource-exhausted', detail: 'invalid recycled PCM credit' });
      return;
    }
    free.set(data.id, data.pcm);
    pendingDrive = true;
    void drive();
  };
  control.onmessage = (event: MessageEvent) => {
    const data = event.data;
    if (data?.type === 'report') {
      if (!web || data.generation !== snapshot().generation) {
        control?.postMessage({ type: 'report-ack' });
        return;
      }
      try {
        web.consumed(data.generation, data.position, data.consumedFrames, data.rate, data.observedAt, data.finished);
        publish(data.finished);
      } catch (error) {
        post({ type: 'error', detail: String(error) });
      }
      control?.postMessage({ type: 'report-ack' });
    } else if (data?.type === 'anchor-ack') {
      anchorWaiters.get(Number(data.generation))?.();
      anchorWaiters.delete(Number(data.generation));
    } else if (data?.type === 'reset-ack') {
      pendingDrive = true;
      void drive();
    } else if (data?.type === 'failed') {
      post({ type: 'error', kind: 'device-unavailable', detail: String(data.detail) });
    }
  };
  for (let index = 0; index < POOL_SIZE; index += 1) free.set(index, new ArrayBuffer(BLOCK_FRAMES * 2 * 4));
  post({ type: 'ready' });
}

async function initialize(): Promise<void> {
  if (web) return;
  await init();
  web = new WebEngine();
}

async function handle(message: WorkerRequest): Promise<void> {
  if (message.type === 'load') {
    try {
      await initialize();
      endedPublished = false;
      const previous = current;
      if (previous) {
        previous.cancelled = true;
        closeCurrent();
      }
      web!.load_options(message.startSeconds, message.subsong ?? undefined, null);
      if (message.replayGain) web!.replay_gain(JSON.stringify(message.replayGain));
      const response = runCommand('load', 0);
      await settleActions(response, message.file, message.autoPlay, message.startSeconds);
      publish(true);
      post({ type: 'result', request: message.request, value: snapshot() });
    } catch (error) {
      const failure = error as { kind?: string; detail?: string; message?: string };
      post({ type: 'result', request: message.request, error: String(failure.detail ?? failure.message ?? error) });
      post({ type: 'error', kind: failure.kind ?? 'decoder-failure', detail: String(failure.detail ?? failure.message ?? error) });
    }
    return;
  }

  if (message.type === 'command') {
    try {
      await initialize();
      const response = runCommand(message.kind, message.value);
      await settleActions(response, null, message.kind === 'play', 0);
      publish(true);
      post({ type: 'result', request: message.request, value: snapshot() });
    } catch (error) {
      const failure = error as { kind?: string; detail?: string; message?: string };
      post({ type: 'result', request: message.request, error: String(failure.detail ?? failure.message ?? error) });
      post({ type: 'error', kind: failure.kind ?? 'decoder-failure', detail: String(failure.detail ?? failure.message ?? error) });
    }
    return;
  }

  if (message.type === 'context') {
    web?.output_state(message.state === 'running' ? 'running' : message.state === 'closed' ? 'closed' : 'suspended');
    syncOutput();
    publish(true);
    return;
  }

  if (message.type === 'close') {
    closeCurrent();
    control?.postMessage({ type: 'close' });
    output?.close();
    control?.close();
    output = null;
    control = null;
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === 'init') {
    attach(event.data);
    return;
  }
  void handle(event.data);
};
