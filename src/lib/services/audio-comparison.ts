export type ComparisonSourceId = 'a' | 'b';
export type ComparisonAuditionMode = ComparisonSourceId | 'difference';
import { logDebug, logInfo } from '$lib/logging/api';

export interface ComparisonRange {
  start: number;
  end: number;
}

export interface LoudnessMatchGains {
  aDb: number;
  bDb: number;
}

interface SourceSettings {
  gainDb: number;
  inverted: boolean;
  channelsSwapped: boolean;
}

interface SourceGraph {
  source: AudioBufferSourceNode;
  preGain: GainNode;
  routeGain: GainNode;
  channelMatrix: [GainNode, GainNode, GainNode, GainNode] | null;
}

const DEFAULT_SOURCE_SETTINGS: SourceSettings = {
  gainDb: 0,
  inverted: false,
  channelsSwapped: false
};

export function getComparisonDuration(a: AudioBuffer | null, b: AudioBuffer | null): number {
  if (a && b) return Math.min(a.duration, b.duration);
  return a?.duration ?? b?.duration ?? 0;
}

export function normalizeComparisonRange(range: ComparisonRange, duration: number): ComparisonRange {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const start = Math.min(Math.max(Number.isFinite(range.start) ? range.start : 0, 0), safeDuration);
  const end = Math.min(Math.max(Number.isFinite(range.end) ? range.end : safeDuration, start), safeDuration);
  return end - start >= 0.001 ? { start, end } : { start: 0, end: safeDuration };
}

export function calculateLoudnessMatchGains(
  aLufs: number | null,
  bLufs: number | null,
  maximumAttenuationDb = 24
): LoudnessMatchGains {
  if (aLufs === null || bLufs === null || !Number.isFinite(aLufs) || !Number.isFinite(bLufs)) {
    return { aDb: 0, bDb: 0 };
  }
  const target = Math.min(aLufs, bLufs);
  const floor = -Math.max(0, maximumAttenuationDb);
  return {
    aDb: Math.max(floor, target - aLufs),
    bDb: Math.max(floor, target - bLufs)
  };
}

export function chooseAbxSource(randomValue: number): ComparisonSourceId {
  return randomValue < 0.5 ? 'a' : 'b';
}

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

export class AudioComparisonEngine {
  private context: AudioContext | null = null;
  private buffers: Record<ComparisonSourceId, AudioBuffer | null> = { a: null, b: null };
  private settings: Record<ComparisonSourceId, SourceSettings> = {
    a: { ...DEFAULT_SOURCE_SETTINGS },
    b: { ...DEFAULT_SOURCE_SETTINGS }
  };
  private graphs: Partial<Record<ComparisonSourceId, SourceGraph>> = {};
  private auditionMode: ComparisonAuditionMode = 'a';
  private range: ComparisonRange = { start: 0, end: 0 };
  private loop = false;
  private crossfadeMs = 15;
  private playing = false;
  private startContextTime = 0;
  private startOffset = 0;
  private pausedPosition = 0;
  private runId = 0;

  constructor(private readonly onEnded: (position: number) => void = () => undefined) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  setBuffer(id: ComparisonSourceId, buffer: AudioBuffer | null): void {
    const wasPlaying = this.playing;
    const position = this.getPosition();
    this.stopGraphs();
    this.buffers[id] = buffer;
    logDebug('tools', 'Comparison buffer set', { id, duration: buffer?.duration ?? 0 });
    const duration = getComparisonDuration(this.buffers.a, this.buffers.b);
    this.range = normalizeComparisonRange(this.range, duration);
    this.pausedPosition = Math.min(position, duration);
    if (wasPlaying && duration > 0) void this.play(this.pausedPosition);
  }

  setAuditionMode(mode: ComparisonAuditionMode): void {
    this.auditionMode = mode;
    logDebug('tools', 'Comparison audition mode changed', { mode });
    this.applyRouteGains();
  }

  setSourceSettings(id: ComparisonSourceId, settings: Partial<SourceSettings>): void {
    this.settings[id] = { ...this.settings[id], ...settings };
    const graph = this.graphs[id];
    if (!graph || !this.context) return;
    const now = this.context.currentTime;
    graph.preGain.gain.setTargetAtTime(
      dbToLinear(this.settings[id].gainDb) * (this.settings[id].inverted ? -1 : 1),
      now,
      0.008
    );
    this.applyChannelMatrix(graph, this.settings[id].channelsSwapped, now);
  }

  setCrossfadeMs(value: number): void {
    this.crossfadeMs = Math.min(500, Math.max(0, Number.isFinite(value) ? value : 0));
  }

  setLoop(enabled: boolean): void {
    if (this.loop === enabled) return;
    this.loop = enabled;
    if (this.playing) void this.play(this.getPosition());
  }

  setRange(range: ComparisonRange): void {
    const duration = getComparisonDuration(this.buffers.a, this.buffers.b);
    this.range = normalizeComparisonRange(range, duration);
    if (this.playing && this.loop) void this.play(this.getPosition());
  }

  async play(position = this.pausedPosition): Promise<void> {
    const duration = getComparisonDuration(this.buffers.a, this.buffers.b);
    if (duration <= 0) return;
    const context = this.context ??= new AudioContext();
    await context.resume();
    this.stopGraphs();

    const range = normalizeComparisonRange(this.range, duration);
    const playbackStart = this.loop
      ? position >= range.start && position < range.end ? position : range.start
      : Math.min(Math.max(position, 0), duration - 0.001);
    const playbackEnd = this.loop ? range.end : duration;
    const when = context.currentTime + 0.015;
    const runId = ++this.runId;

    for (const id of ['a', 'b'] as const) {
      const buffer = this.buffers[id];
      if (!buffer) continue;
      const graph = this.createSourceGraph(id, buffer);
      graph.source.loop = this.loop;
      if (this.loop) {
        graph.source.loopStart = range.start;
        graph.source.loopEnd = range.end;
        graph.source.start(when, playbackStart);
      } else {
        graph.source.start(when, playbackStart, Math.max(0.001, playbackEnd - playbackStart));
      }
      this.graphs[id] = graph;
    }

    const primary = this.graphs.a?.source ?? this.graphs.b?.source;
    if (primary && !this.loop) {
      primary.onended = () => {
        if (this.runId !== runId || !this.playing) return;
        this.playing = false;
        this.disconnectGraphs();
        this.pausedPosition = playbackEnd;
        this.onEnded(playbackEnd);
      };
    }
    this.startContextTime = when;
    this.startOffset = playbackStart;
    this.pausedPosition = playbackStart;
    this.playing = true;
    this.applyRouteGains(true);
    logInfo('tools', 'Comparison playback started', { mode: this.auditionMode, position: playbackStart });
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedPosition = this.getPosition();
    this.stopGraphs();
  }

  stop(): void {
    this.stopGraphs();
    this.pausedPosition = this.loop ? this.range.start : 0;
  }

  seek(position: number): void {
    const duration = getComparisonDuration(this.buffers.a, this.buffers.b);
    const next = Math.min(Math.max(Number.isFinite(position) ? position : 0, 0), duration);
    if (this.playing) void this.play(next);
    else this.pausedPosition = next;
  }

  getPosition(): number {
    if (!this.playing || !this.context) return this.pausedPosition;
    const elapsed = Math.max(0, this.context.currentTime - this.startContextTime);
    if (this.loop) {
      const length = Math.max(0.001, this.range.end - this.range.start);
      return this.range.start + ((this.startOffset - this.range.start + elapsed) % length);
    }
    return Math.min(getComparisonDuration(this.buffers.a, this.buffers.b), this.startOffset + elapsed);
  }

  async close(): Promise<void> {
    this.stopGraphs();
    const context = this.context;
    this.context = null;
    if (context) await context.close();
  }

  private createSourceGraph(id: ComparisonSourceId, buffer: AudioBuffer): SourceGraph {
    const context = this.context!;
    const source = context.createBufferSource();
    const preGain = context.createGain();
    const routeGain = context.createGain();
    let channelMatrix: SourceGraph['channelMatrix'] = null;
    source.buffer = buffer;

    if (buffer.numberOfChannels === 2) {
      const splitter = context.createChannelSplitter(2);
      const merger = context.createChannelMerger(2);
      const leftToLeft = context.createGain();
      const leftToRight = context.createGain();
      const rightToLeft = context.createGain();
      const rightToRight = context.createGain();
      source.connect(splitter);
      splitter.connect(leftToLeft, 0);
      splitter.connect(leftToRight, 0);
      splitter.connect(rightToLeft, 1);
      splitter.connect(rightToRight, 1);
      leftToLeft.connect(merger, 0, 0);
      rightToLeft.connect(merger, 0, 0);
      leftToRight.connect(merger, 0, 1);
      rightToRight.connect(merger, 0, 1);
      merger.connect(preGain);
      channelMatrix = [leftToLeft, leftToRight, rightToLeft, rightToRight];
    } else {
      source.connect(preGain);
    }

    preGain.connect(routeGain);
    routeGain.connect(context.destination);
    const graph = { source, preGain, routeGain, channelMatrix };
    preGain.gain.value = dbToLinear(this.settings[id].gainDb) * (this.settings[id].inverted ? -1 : 1);
    this.applyChannelMatrix(graph, this.settings[id].channelsSwapped, context.currentTime, true);
    routeGain.gain.value = 0;
    return graph;
  }

  private applyChannelMatrix(graph: SourceGraph, swapped: boolean, now: number, immediate = false): void {
    if (!graph.channelMatrix) return;
    const values = swapped ? [0, 1, 1, 0] : [1, 0, 0, 1];
    graph.channelMatrix.forEach((gain, index) => {
      if (immediate) gain.gain.value = values[index];
      else gain.gain.setTargetAtTime(values[index], now, 0.006);
    });
  }

  private applyRouteGains(immediate = false): void {
    if (!this.context) return;
    const targets: Record<ComparisonSourceId, number> = this.auditionMode === 'difference'
      ? { a: 0.7, b: -0.7 }
      : { a: this.auditionMode === 'a' ? 1 : 0, b: this.auditionMode === 'b' ? 1 : 0 };
    const now = this.context.currentTime;
    const end = now + this.crossfadeMs / 1000;
    for (const id of ['a', 'b'] as const) {
      const gain = this.graphs[id]?.routeGain.gain;
      if (!gain) continue;
      gain.cancelScheduledValues(now);
      if (immediate || this.crossfadeMs === 0) gain.setValueAtTime(targets[id], now);
      else {
        gain.setValueAtTime(gain.value, now);
        gain.linearRampToValueAtTime(targets[id], end);
      }
    }
  }

  private stopGraphs(): void {
    this.runId += 1;
    for (const graph of Object.values(this.graphs)) {
      try {
        graph.source.stop();
      } catch {
        // A source that has already ended needs no further cleanup.
      }
    }
    this.disconnectGraphs();
    this.playing = false;
  }

  private disconnectGraphs(): void {
    for (const graph of Object.values(this.graphs)) {
      graph.source.disconnect();
      graph.preGain.disconnect();
      graph.routeGain.disconnect();
      graph.channelMatrix?.forEach((gain) => gain.disconnect());
    }
    this.graphs = {};
  }
}
